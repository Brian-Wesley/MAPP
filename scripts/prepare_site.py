"""Sync the static page after updating data/ and the resource-profile figure.

Anaconda Prompt (base), from MAPP:
    python -B scripts/prepare_site.py
    python -B scripts/prepare_site.py --check

Uses only MAPP files, validates the figure audit, exports lightweight interactive
coordinates, and updates index.html image dimensions, figure counts and
content-hashed asset URLs. No research repository,
network connection or third-party Python packages are required.
"""

import argparse
from collections import Counter
import hashlib
import json
import os
from pathlib import Path
import re
import struct

ROOT = Path(__file__).resolve().parents[1]


def portable_details(root, check=False):
    """Package logical con/prn/... detail paths under Git-safe physical names."""
    folder = (Path(root) / 'data/languages').resolve()
    reserved = [path for path in folder.iterdir() if re.fullmatch(r'(con|prn|aux|nul|com[1-9]|lpt[1-9])\.json', path.name, re.I)]
    require(not check or not reserved, 'Reserved Windows detail filenames found. Run python -B scripts/prepare_site.py first.')
    for path in reserved:
        target = folder / f'iso-{path.name}'
        require(path.parent == folder and target.parent == folder, 'Invalid detail directory')
        # Extended absolute paths address the real files, not Windows devices.
        source_name = '\\\\?\\' + str(path) if os.name == 'nt' else str(path)
        target_name = '\\\\?\\' + str(target) if os.name == 'nt' else str(target)
        with open(source_name, 'rb') as handle:
            require(json.load(handle)['code'] == path.stem, f'Unexpected language code in {path.name}')
        os.replace(source_name, target_name)
        print(f'Packaged: data/languages/{path.name} -> data/languages/{target.name}')


def require(condition, message):
    if not condition:
        raise ValueError(message)


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def read(path):
    return json.loads(path.read_text(encoding='utf-8-sig'))


def local_file(folder, relative):
    path = (folder / relative).resolve()
    require(path.is_relative_to(folder.resolve()), 'Invalid file path in audit')
    return path


def replace_once(text, pattern, replacement):
    result, count = re.subn(pattern, replacement, text)
    require(count == 1, f'Expected exactly one HTML match for {pattern}')
    return result


def attribute(html, element_id, name, value):
    def update(match):
        tag = match.group(0)
        pattern = rf'\b{re.escape(name)}="[^"]*"'
        if re.search(pattern, tag):
            return re.sub(pattern, lambda _: f'{name}="{value}"', tag)
        return tag[:-1] + f' {name}="{value}">'
    return replace_once(html, rf'<[^>]*\bid="{re.escape(element_id)}"[^>]*>', update)


def prepared_html(root):
    root = Path(root)
    assets, data = root / 'assets', root / 'data'
    manifest = read(data / 'manifest.json')
    audit = read(assets / 'language_resource_profiles_audit.json')
    require(audit['data_version'] == manifest['data_version'],
            'Figure and data versions differ. Regenerate language_resource_profiles first.')
    for relative, expected in audit['data_files_sha256'].items():
        require(sha(local_file(data, relative)) == expected, f'Data changed since figure export: {relative}')
    require({'language_resource_profiles.png', 'language_resource_profiles.pdf'} <= audit['outputs_sha256'].keys(),
            'The figure audit must include both PNG preview and PDF download.')
    for relative, expected in audit['outputs_sha256'].items():
        require(sha(local_file(assets, relative)) == expected, f'Figure checksum mismatch: {relative}')
    rows = read(local_file(data, manifest['files']['index']))
    by_code = {row['code']: row for row in rows}
    require(len(by_code) == len(rows) == audit['language_count'] == manifest['language_count'], 'Language count mismatch')
    require(dict(Counter(row['regime'] for row in rows)) == audit['regime_counts'], 'Figure/index group count mismatch')
    plotted = audit['plotted_languages']
    plotted_codes = {point['code'] for point in plotted}
    omitted_codes = {point['code'] for point in audit['omitted_languages']}
    require(len(plotted_codes) == len(plotted) == audit['plotted_count'], 'Duplicate or missing figure point')
    require(not plotted_codes & omitted_codes and plotted_codes | omitted_codes == by_code.keys(), 'Incomplete figure language mapping')
    for point in plotted:
        row = by_code[point['code']]
        require((point['pretrain_cluster'], point['posttrain_cluster'], point['regime'], point['NCC'], point['sample_equivalents']) ==
                (row['pretrain']['cluster'], row['posttrain']['cluster'], row['regime'], row['pretrain']['quantity'], row['posttrain']['quantity']),
                f'Figure/index point mismatch: {point["code"]}')
    require(audit['ci_display_scale'] == 10 and audit['ci_display_scale_overrides'] == {'abk': 2, 'zul': 2, 'eng': 2, 'nav': 5},
            'CI display policy changed; update the explanatory text before publishing.')
    png = (assets / 'language_resource_profiles.png').read_bytes()
    require(png[:8] == b'\x89PNG\r\n\x1a\n' and png[12:16] == b'IHDR', 'Invalid PNG header')
    width, height = struct.unpack('>II', png[16:24])
    html = (root / 'index.html').read_text(encoding='utf-8')
    html = attribute(html, 'resource-profiles-figure', 'data-version', audit['data_version'])
    html = attribute(html, 'resource-profiles-image', 'width', width)
    html = attribute(html, 'resource-profiles-image', 'height', height)
    html = attribute(html, 'resource-profiles-image', 'alt',
                     f'Pre-training and post-training quantities for {len(plotted):,} living languages, colored by five development priorities, with a separate band for languages without observed usable post-training data.')
    counts = {'plotted': len(plotted), 'bootstrap': audit['regime_counts'].get('bootstrap-post-training', 0),
              'scale': audit['regime_counts'].get('scale-up-post-training', 0),
              'diversify': audit['regime_counts'].get('diversify-post-training', 0),
              'omitted': sum(point['reason'] == 'no_usable_pretraining_quantity' for point in audit['omitted_languages'])}
    for key, value in counts.items():
        html = replace_once(html, rf'(<span id="profile-stat-{key}">)[^<]*(</span>)',
                            lambda match: f'{match[1]}{value:,}{match[2]}')
    def version_asset(match):
        path = local_file(root, match['path'])
        return f'{match["attribute"]}="{match["path"]}?v={sha(path)[:12]}"'
    html = re.sub(r'(?P<attribute>src|href)="(?P<path>assets/[^?"<>]+)(?:\?[^"<>]*)?"', version_asset, html)
    return html


def profile_points(root):
    """Compact interactive coordinates from the same audited paper snapshot."""
    audit = read(Path(root) / 'assets/language_resource_profiles_audit.json')
    points = [[point['code'], point['x_log10_NCC'], point['y_log10_samples'], point['categorical_jitter']]
              for point in audit['plotted_languages']]
    return json.dumps({'data_version': audit['data_version'], 'points': points},
                      ensure_ascii=False, separators=(',', ':'), allow_nan=False) + '\n'


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--check', action='store_true', help='Verify the page is synchronized, without modifying it')
    args = parser.parse_args()
    try:
        portable_details(ROOT, check=args.check)
        html = prepared_html(ROOT)
        points = profile_points(ROOT)
        points_file = ROOT / 'assets/resource-profile-points.json'
        index = ROOT / 'index.html'
        if args.check:
            require(index.read_text(encoding='utf-8') == html, 'Page needs syncing. Run python -B scripts/prepare_site.py')
            require(points_file.read_text(encoding='utf-8') == points, 'Interactive points need syncing. Run python -B scripts/prepare_site.py')
            print('Verified: figure, data, page statistics and asset URLs are synchronized.')
        else:
            points_file.write_text(points, encoding='utf-8', newline='\n')
            index.write_text(html, encoding='utf-8', newline='\n')
            print(f'Updated: {index}')
        return 0
    except (OSError, ValueError, KeyError, TypeError) as error:
        parser.exit(1, f'Error: {error}\n')


if __name__ == '__main__':
    raise SystemExit(main())
