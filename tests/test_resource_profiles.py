"""Run with Anaconda base: python -B -m unittest discover -s tests -p test_resource_profiles.py"""
from collections import Counter
import importlib.util
import json
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

import pandas as pd

spec = importlib.util.spec_from_file_location('update_profiles', Path(__file__).resolve().parents[1] / 'scripts/update_resource_profiles.py')
update = importlib.util.module_from_spec(spec)
spec.loader.exec_module(update)


class ProfileTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.folder = Path(self.temp.name)
        self.data = self.folder / 'data'
        (self.data / 'languages').mkdir(parents=True)
        pairs = [[(0, -1), (0, 0)], [(1, -1), (2, -1)], [(1, 0), (2, 0)], [(2, 1)], [(2, 2)]]
        regimes = [dict(id=ident, cluster_pairs=group) for ident, group in zip(update.REGIME_IDS, pairs)]
        regimes.append(dict(id='neither-stage-eligible', cluster_pairs=[(-1, -1)]))
        self.rows = []
        for code, regime in zip(('aaa', 'bbb', 'ccc', 'ddd', 'eee', 'fff'), regimes):
            pre, post = regime['cluster_pairs'][0]
            stage = lambda cluster: dict(cluster=cluster, quantity=None if cluster == -1 else 100,
                                         status='uncovered' if cluster == -1 else 'clustered')
            row = dict(code=code, name=code, family=None, regime=regime['id'],
                       pretrain=stage(pre), posttrain=stage(post), details=f'languages/{code}.json')
            self.rows.append(row)
            detail = json.loads(json.dumps(row))
            detail['pretrain']['quantity_ci95'] = dict(lower=80, upper=120)
            self.write(row['details'], detail)
            regime['n_languages'] = 1
        clusters = dict(regimes=regimes)
        for stage in ('pretrain', 'posttrain'):
            clusters[stage] = [dict(cluster=key, n_languages=count) for key, count in Counter(row[stage]['cluster'] for row in self.rows).items()]
        self.write('clusters.json', clusters)
        self.write('languages.json', self.rows)
        self.write('manifest.json', dict(schema_version='language-resource-explorer/1', data_version='test-v1',
                                        language_count=6, files=dict(index='languages.json', clusters='clusters.json')))
        renderer = SimpleNamespace(pd=pd, SEMANTIC_GROUPS=list(zip(update.REGIME_IDS, pairs)),
                                   PAIR_ORDER=[pair for group in pairs for pair in group],
                                   choose_examples=lambda points: {row.pair: [code] for code, row in points.iterrows()},
                                   stable_missing_jitter=lambda code: 0.5,
                                   NCC_CI_DISPLAY_SCALE=10, NCC_CI_DISPLAY_SCALE_OVERRIDES={})
        self.renderer = patch.object(update, 'load_renderer', return_value=(renderer, 'renderer-hash'))
        self.renderer.start()
        self.addCleanup(self.renderer.stop)

    def write(self, name, value):
        (self.data / name).write_text(json.dumps(value), encoding='utf-8')

    def prepare(self):
        return update.prepare(self.data, self.folder)

    def test_saved_membership_log_coordinates_and_omissions(self):
        prepared = self.prepare()
        self.assertEqual(len(prepared['points']), 5)
        self.assertEqual(prepared['points'].loc['ddd', 'log_pre'], 2)
        self.assertEqual(prepared['points'].loc['ddd', 'log_post'], 2)
        self.assertEqual(prepared['intervals']['ddd'], dict(quantity=100, lower=80, upper=120))
        audit = update.build_audit(prepared, {})
        self.assertEqual(audit['omitted_languages'][0]['code'], 'fff')
        point = next(point for point in audit['plotted_languages'] if point['code'] == 'bbb')
        self.assertIsNone(point['y_log10_samples'])
        self.assertEqual(point['categorical_jitter'], 0.5)
        self.assertEqual(audit['data_version'], 'test-v1')

    def test_invalid_regime_does_not_get_reclassified(self):
        self.rows[0]['regime'] = 'refine-both-stages'
        self.write('languages.json', self.rows)
        with self.assertRaisesRegex(ValueError, 'regime/pair mismatch'):
            self.prepare()

    def test_below_axis_quantity_is_not_silently_clipped(self):
        self.rows[0]['pretrain']['quantity'] = 0.5
        self.write('languages.json', self.rows)
        with self.assertRaisesRegex(ValueError, 'would clip'):
            self.prepare()

    def test_snapshot_changes_and_path_escape_are_rejected(self):
        snapshot = self.prepare()['snapshot']
        with self.assertRaisesRegex(ValueError, 'Invalid snapshot path'):
            snapshot.read('../outside.json')
        self.rows[0]['name'] = 'Updated name'
        self.write('languages.json', self.rows)
        with self.assertRaisesRegex(ValueError, 'Data changed'):
            snapshot.check_unchanged()

    def test_verifier_detects_changed_output_and_data_version(self):
        prepared = self.prepare()
        audit = update.build_audit(prepared, {})
        output = self.folder / 'assets'
        output.mkdir()
        name = f'{update.STEM}.png'
        (output / name).write_bytes(b'test output checksum')
        audit['outputs_sha256'] = {name: update.digest((output / name).read_bytes())}
        (output / f'{update.STEM}_audit.json').write_text(json.dumps(audit), encoding='utf-8')
        update.verify_outputs(prepared, output)
        (output / name).write_bytes(b'changed output')
        with self.assertRaisesRegex(ValueError, 'Figure file changed'):
            update.verify_outputs(prepared, output)
        prepared['manifest']['data_version'] = 'test-v2'
        with self.assertRaisesRegex(ValueError, 'versions differ'):
            update.verify_outputs(prepared, output)


if __name__ == '__main__':
    unittest.main()
