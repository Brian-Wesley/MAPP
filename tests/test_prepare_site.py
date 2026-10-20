"""Verify the actual published snapshot, without requiring the research repo."""
import importlib.util
import json
import csv
import tempfile
from pathlib import Path
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('prepare_site', ROOT / 'scripts/prepare_site.py')
site = importlib.util.module_from_spec(spec)
spec.loader.exec_module(site)


class SiteTests(unittest.TestCase):
    def test_dataset_catalog_includes_the_full_original_inventory(self):
        catalog = site.dataset_catalog(ROOT)
        for stage, expected in [('pretrain', 36), ('posttrain', 188)]:
            rows = catalog['stages'][stage]
            self.assertEqual(len(rows), expected)
            self.assertEqual(len(rows), len({row['name'] for row in rows}))
        pre = {row['name'] for row in catalog['stages']['pretrain']}
        self.assertTrue({'CC100-XL', 'DCLM-Pool', 'HPLT_v2.0'} <= pre)
        post = {row['name'] for row in catalog['stages']['posttrain']}
        self.assertTrue({'Alpaca', 'OpenMathInstruct-1', 'OpenCodeReasoning'} <= post)
        aya = [row for row in catalog['stages']['posttrain'] if row['name'] == 'Aya Dataset']
        self.assertEqual(len(aya), 1)
        self.assertEqual(aya[0]['release_date'], '2024-01-31')
        self.assertEqual(aya[0]['date_sources'], ['HF Date'])
        self.assertIn('https://arxiv.org/abs/2402.06619', aya[0]['paper_links'])
        self.assertEqual(sum(row['release_date'] is not None for row in catalog['stages']['posttrain']), 182)
        self.assertEqual(sum(row['release_date'] is not None for row in catalog['stages']['pretrain']), 35)
        for row in catalog['stages']['pretrain']:
            if row['name'] in ('CulturaX', 'HPLT_v2.0'):
                self.assertEqual(row['release_date'], '2024')
                self.assertEqual(row['date_basis'], 'publication')
        site.prepare_dataset_catalog(ROOT, check=True)

    def test_original_collection_import_counts_each_multilingual_record_once(self):
        with tempfile.TemporaryDirectory(dir=ROOT / 'tmp') as temporary:
            source = Path(temporary)
            record = {'Collection': 'Example', 'Languages': ['eng', 'fra'],
                      'Text Metrics': {'Num Unicode Characters': 100, 'Num Dialogs': 10},
                      'Task Macro Categories': ['QA'], 'Text Source Categories': ['Human-Created'],
                      'Inferred Metadata': {'HF Date': '2024-01-31', 'Last Modified': '2025-01-01'}}
            missing = {**record, 'Languages': [], 'Text Metrics': {}}
            for stage in ['pretrain', 'posttrain']:
                folder = source / f'meta_data_{stage}'
                folder.mkdir()
                (folder / 'different-filename.json').write_text(json.dumps({'shared': record, 'missing': missing}), encoding='utf-8')
            imported = site.import_collection_metadata(ROOT, source)
            pre = imported['stages']['pretrain']['Example']
            post = imported['stages']['posttrain']['Example']
            self.assertEqual(pre['quantity'], 100)
            self.assertEqual(post['quantity'], 10)
            self.assertEqual(pre['language_count'], 2)
            self.assertTrue(pre['quantity_partial'])
            self.assertTrue(pre['language_count_partial'])
            self.assertEqual(pre['dataset_count'], 2)
            upstream = source / 'data_summaries_pretrain'
            upstream.mkdir()
            upstream_record = {**record, 'Languages': ['zho'], 'Text Metrics': {'Num Unicode Characters': 999},
                               'Inferred Metadata': {'Github Date': '2022-05-06'}}
            (upstream / 'raw-name.json').write_text(json.dumps({'shared': upstream_record}), encoding='utf-8')
            refreshed = site.import_collection_metadata(ROOT, source)
            self.assertEqual(refreshed['stages']['pretrain']['Example'],
                             {**pre, 'release_date': '2022-05-06', 'date_sources': ['Github Date']})
            self.assertEqual(refreshed['stages']['posttrain']['Example'], post)
            self.assertIn('data_summaries_pretrain/raw-name.json', refreshed['sources_sha256'])
            (source / 'meta_data_posttrain/duplicate.json').write_text(json.dumps({'shared': record}), encoding='utf-8')
            with self.assertRaisesRegex(ValueError, 'Duplicate dataset ID'):
                site.import_collection_metadata(ROOT, source)
        self.assertEqual(site.web_links(['https://example.org', 'javascript:alert(1)', None]), {'https://example.org'})

    def test_collection_dates_use_nested_metadata_and_preserve_the_basis(self):
        values = [{'Inferred Metadata': {'HF Date': '2024-01-31', 'S2 Date': '2024-02-09',
                                         'Last Modified': '2026-01-01', 'Run Timestamp UTC': '2026-10-19'}}]
        self.assertEqual(site.collection_date(values), {'release_date': '2024-01-31', 'date_basis': 'repository', 'date_sources': ['HF Date']})
        values.append({'Inferred Metadata': {'Github Date': '2024-01-01'}})
        self.assertEqual(site.collection_date(values)['release_date'], '2024-01-01')
        self.assertEqual(site.collection_date([{'Inferred Metadata': {'Created At': '2024-06-12'}}])['release_date'], '2024-06-12')
        self.assertEqual(site.collection_date([{'Inferred Metadata': {'S2 Date': '2023-02-10'}}])['date_basis'], 'publication')
        self.assertIsNone(site.collection_date([{'Inferred Metadata': {'HF Date': '2024-02-30', 'Last Modified': '2026-01-01'}}])['release_date'])

    def test_collection_paper_fallback_preserves_precision_and_date_priority(self):
        paper = {'Paper URL': 'https://aclanthology.org/2024.lrec-main.377/'}
        result = site.collection_date([paper])
        self.assertEqual(result['release_date'], '2024')
        self.assertEqual(result['date_basis'], 'publication')
        self.assertIn(paper['Paper URL'], result['date_sources'][0])
        self.assertEqual(site.collection_date([{**paper, 'Inferred Metadata': {'HF Date': '2023-09-01'}}])['release_date'], '2023-09-01')
        preprint = {'ArXiv URL': 'https://arxiv.org/abs/2304.01196v4'}
        self.assertEqual(site.collection_date([preprint])['release_date'], '2023-04')
        self.assertEqual(site.collection_date([preprint])['date_basis'], 'preprint')
        self.assertEqual(site.collection_date([paper, preprint])['release_date'], '2024')
        self.assertEqual(site.collection_date([{'Bibtex': '@article{x, year={2022}}'}])['release_date'], '2022')
        for link in ['https://example.com/2024/paper', 'https://aclanthology.org.evil.test/2024.lrec-main.377/',
                     'https://arxiv.org/abs/2313.01196', 'https://aclanthology.org/2024.lrec-main.0/extra']:
            self.assertIsNone(site.collection_date([{'Paper URL': link}])['release_date'])

    def test_metadata_snapshot_covers_the_website_index(self):
        metadata = site.filter_metadata(ROOT)
        rows = site.read(ROOT / 'data/languages.json')
        self.assertEqual(set(metadata['languages']), {row['code'] for row in rows})
        self.assertEqual(metadata['languages']['ara'], ['Macrolanguage', 'Living', 'no canonical Glottolog match'])

    def test_metadata_import_reuses_columns_and_rejects_stage_disagreement(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / 'data').mkdir()
            (root / 'data/manifest.json').write_text(json.dumps({'data_version': 'test', 'files': {'index': 'languages.json'}}), encoding='utf-8')
            (root / 'data/languages.json').write_text(json.dumps([{'code': 'eng'}, {'code': 'ara'}]), encoding='utf-8')
            records = [['eng', 'Individual language', 'Living', 'genetic family'], ['ara', 'Macrolanguage', 'Living', '']]
            def write_stage(stage, values):
                folder = root / f'meta_data_{stage}_joined'
                folder.mkdir(exist_ok=True)
                with (folder / 'genealogical_family_analysis_joined.csv').open('w', encoding='utf-8', newline='') as stream:
                    writer = csv.writer(stream)
                    writer.writerow(['Language', 'ISO_scope', 'ISO_language_type', 'classification_status'])
                    writer.writerows(values)
            for stage in ('pretrain', 'posttrain'):
                write_stage(stage, records)
            imported = site.import_filter_metadata(root, root)
            self.assertEqual(imported['languages']['eng'], records[0][1:])
            self.assertIsNone(imported['languages']['ara'][2])
            self.assertEqual(len(imported['sources_sha256']), 2)
            write_stage('posttrain', [records[0], ['ara', 'Macrolanguage', 'Living', 'genetic family']])
            with self.assertRaisesRegex(ValueError, 'disagree'):
                site.import_filter_metadata(root, root)
            write_stage('posttrain', [records[0]])
            with self.assertRaisesRegex(ValueError, 'missing website languages'):
                site.import_filter_metadata(root, root)

    def test_page_is_synchronized_and_sync_is_idempotent(self):
        actual = (ROOT / 'index.html').read_text(encoding='utf-8')
        self.assertEqual(site.prepared_html(ROOT), actual)

    def test_interactive_coordinates_match_the_audited_paper_snapshot(self):
        actual = (ROOT / 'assets/resource-profile-points.json').read_text(encoding='utf-8')
        self.assertEqual(site.profile_points(ROOT), actual)
        points = json.loads(actual)
        audit = site.read(ROOT / 'assets/language_resource_profiles_audit.json')
        self.assertEqual(points['data_version'], audit['data_version'])
        self.assertEqual(len(points['points']), audit['plotted_count'])
        self.assertEqual(len({point[0] for point in points['points']}), audit['plotted_count'])

    def test_stale_data_or_image_is_rejected(self):
        real_sha = site.sha
        for target in ['languages.json', 'language_resource_profiles.png', 'language_resource_profiles.pdf']:
            with self.subTest(target=target):
                with patch.object(site, 'sha', side_effect=lambda path: 'changed' if path.name == target else real_sha(path)):
                    with self.assertRaisesRegex(ValueError, 'Data changed|checksum mismatch'):
                        site.prepared_html(ROOT)

    def test_mixed_snapshot_versions_are_rejected(self):
        real_read = site.read
        def changed_manifest(path):
            value = real_read(path)
            if path.name == 'manifest.json':
                value['data_version'] = 'another-version'
            return value
        with patch.object(site, 'read', side_effect=changed_manifest):
            with self.assertRaisesRegex(ValueError, 'versions differ'):
                site.prepared_html(ROOT)


if __name__ == '__main__':
    unittest.main()
