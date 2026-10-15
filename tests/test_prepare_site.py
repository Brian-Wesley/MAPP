"""Verify the actual published snapshot, without requiring the research repo."""
import importlib.util
import json
from pathlib import Path
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('prepare_site', ROOT / 'scripts/prepare_site.py')
site = importlib.util.module_from_spec(spec)
spec.loader.exec_module(site)


class SiteTests(unittest.TestCase):
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
