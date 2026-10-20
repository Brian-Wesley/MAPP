"""Sync the static page after updating data/ and the resource-profile figure.

Anaconda Prompt (base), from MAPP:
    python -B scripts/prepare_site.py
    python -B scripts/prepare_site.py --check

To refresh Explorer metadata from existing join_language_clusters.py outputs:
    python -B scripts/prepare_site.py --metadata-source-root <research repository>
Only ISO_scope, ISO_language_type and classification_status are imported. The
saved data/explorer-filters.json is reused by subsequent local-only runs.

To refresh the complete Dataset Catalog from original metadata:
    python -B scripts/prepare_site.py --collection-source-root <research repository>
Saved data/collection-metadata.json is reused locally. This independent catalog
includes all original collections, without the Language Explorer's filtering.
Pre-training dates are also read from data_summaries_pretrain, matched by
Collection and dataset ID. Only date fields are supplemented; quantities,
tasks and language coverage still come from meta_data_pretrain/posttrain.

Uses only MAPP files, validates the figure audit, exports lightweight interactive
coordinates and static-script data for anonymous hosting, and updates index.html image dimensions, figure counts and
content-hashed asset URLs. No research repository,
network connection or third-party Python packages are required.
"""

import argparse
import csv
from collections import Counter
from datetime import date
import hashlib
import json
import math
import os
from pathlib import Path
import re
import struct
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[1]
FILTER_COLUMNS = {'iso_scope': 'ISO_scope', 'iso_language_type': 'ISO_language_type',
                  'classification_status': 'classification_status'}


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
    html = attribute(html, 'dataset-catalog', 'data-version', read(data / 'dataset-catalog.json')['catalog_version'])
    html = attribute(html, 'resource-profiles-figure', 'data-version', audit['data_version'])
    if (assets / 'static-data/catalog.js').is_file():
        html = attribute(html, 'resource-profiles-figure', 'data-static-version', sha(assets / 'static-data/catalog.js')[:12])
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


def filter_metadata(root):
    """Validate the locally saved metadata snapshot without a research checkout."""
    root = Path(root)
    manifest = read(root / 'data/manifest.json')
    rows = read(local_file(root / 'data', manifest['files']['index']))
    metadata = read(root / 'data/explorer-filters.json')
    require(metadata['data_version'] == manifest['data_version'],
            'Filter metadata version differs. Run prepare_site.py --metadata-source-root <research repository>.')
    require(metadata['fields'] == list(FILTER_COLUMNS), 'Unexpected filter metadata fields')
    require(set(metadata['languages']) == {row['code'] for row in rows}, 'Filter metadata language coverage differs')
    require(all(isinstance(values, list) and len(values) == len(FILTER_COLUMNS) and
                all(value is None or isinstance(value, str) and value.strip() for value in values)
                for values in metadata['languages'].values()), 'Invalid filter metadata values')
    return metadata


def import_filter_metadata(root, source_root):
    """Reuse the three columns already produced by join_language_clusters.py."""
    root, source_root = Path(root), Path(source_root)
    manifest = read(root / 'data/manifest.json')
    rows = read(local_file(root / 'data', manifest['files']['index']))
    codes = {row['code'] for row in rows}
    stages, sources = [], {}
    for stage in ('pretrain', 'posttrain'):
        relative = f'meta_data_{stage}_joined/genealogical_family_analysis_joined.csv'
        path = source_root / relative
        with path.open(encoding='utf-8-sig', newline='') as stream:
            reader = csv.DictReader(stream)
            require({'Language', *FILTER_COLUMNS.values()} <= set(reader.fieldnames or []), f'Missing metadata columns: {relative}')
            indexed = {}
            for row in reader:
                code = row['Language'].strip().lower()
                require(re.fullmatch('[a-z]{3}', code) and code not in indexed, f'Invalid or duplicate language: {relative}: {code}')
                indexed[code] = [row[column].strip() or None for column in FILTER_COLUMNS.values()]
        require(codes <= indexed.keys(), f'Metadata missing website languages: {relative}')
        stages.append({code: indexed[code] for code in sorted(codes)})
        sources[relative] = sha(path)
    require(stages[0] == stages[1], 'Pre-training and post-training language metadata disagree')
    return {'data_version': manifest['data_version'], 'fields': list(FILTER_COLUMNS),
            'sources_sha256': sources, 'languages': stages[0]}


def static_data_scripts(root):
    """Classic-script data assets for hosts that sandbox pages to opaque origins.

    These contain only the same public JSON data. Details are loaded lazily in
    ISO-initial chunks, rather than downloading every language on page load.
    """
    root = Path(root)
    manifest = read(root / 'data/manifest.json')
    rows = read(local_file(root / 'data', manifest['files']['index']))
    def assignment(target, value):
        payload = json.dumps(value, ensure_ascii=False, separators=(',', ':'), allow_nan=False)
        return f'{target}=JSON.parse({json.dumps(payload)});\n'
    yield 'catalog.js', assignment('globalThis.MappStaticCatalog', {
        'manifest': manifest,
        'clusters': read(local_file(root / 'data', manifest['files']['clusters'])),
        'index': rows,
        'filter_metadata': filter_metadata(root),
        'points': json.loads(profile_points(root)),
    })
    for initial in sorted({row['code'][0] for row in rows}):
        details = {}
        for row in rows:
            if row['code'][0] != initial:
                continue
            relative = re.sub(r'(^|/)(con|prn|aux|nul|com[1-9]|lpt[1-9])\.json$', r'\1iso-\2.json', row['details'])
            detail = read(local_file(root / 'data', relative))
            require(all(detail[key] == row[key] for key in ('code', 'name', 'family', 'regime')),
                    f'Detail identity mismatch: {row["code"]}')
            for stage in ('pretrain', 'posttrain'):
                require(all(detail[stage][key] == row[stage][key] for key in ('cluster', 'status', 'quantity')),
                        f'Detail/index mismatch: {row["code"]} {stage}')
            details[row['code']] = detail
        yield f'details-{initial}.js', ('globalThis.MappStaticDetails=globalThis.MappStaticDetails||{};\n' +
            assignment(f'globalThis.MappStaticDetails.{initial}', {'data_version': manifest['data_version'], 'languages': details}))


def prepare_static_data(root, check=False):
    folder = Path(root) / 'assets/static-data'
    if not check:
        folder.mkdir(exist_ok=True)
    for name, content in static_data_scripts(root):
        path = folder / name
        if check:
            require(path.is_file() and path.read_text(encoding='utf-8') == content,
                    f'Static data needs syncing: {name}. Run python -B scripts/prepare_site.py')
        elif not path.is_file() or path.read_text(encoding='utf-8') != content:
            path.write_text(content, encoding='utf-8', newline='\n')


def web_links(value):
    values = value if isinstance(value, list) else [value]
    return {item.strip() for item in values if isinstance(item, str)
            and urlsplit(item.strip()).scheme in ('http', 'https') and urlsplit(item.strip()).netloc}


def collection_date(records):
    """Prefer explicit release dates, then repository creation, then publication.

    Keep each date's basis; never use crawl/run/last-modified timestamps.
    """
    tiers = [('release', ('Release Date', 'Publication Date')),
             ('repository', ('HF Date', 'Created At', 'Github Date', 'GitHub Date')),
             ('publication', ('S2 Date', 'PwC Date'))]
    for basis, fields in tiers:
        candidates = []
        for record in records:
            for container in (record, record.get('Inferred Metadata', {})):
                for field in fields:
                    value = container.get(field)
                    if isinstance(value, str) and re.match(r'^\d{4}-\d{2}-\d{2}(?:$|T| )', value):
                        try:
                            candidates.append((date.fromisoformat(value[:10]).isoformat(), field))
                        except ValueError:
                            pass
        if candidates:
            earliest = min(item[0] for item in candidates)
            return {'release_date': earliest, 'date_basis': basis,
                    'date_sources': sorted({field for value, field in candidates if value == earliest})}
    return {'release_date': None, 'date_basis': None, 'date_sources': []}


def collection_version(stages, hashes):
    payload = json.dumps({'stages': stages, 'sources_sha256': hashes}, ensure_ascii=False,
                         sort_keys=True, separators=(',', ':'), allow_nan=False)
    return hashlib.sha256(payload.encode('utf-8')).hexdigest()[:16]


def import_collection_metadata(root, source_root):
    # Read each original record once. Do not use filtered/reduced exports or
    # multiply a multilingual record's quantity by its language count.
    stages, hashes = {}, {}
    for stage in ('pretrain', 'posttrain'):
        grouped = {}
        paths = sorted((Path(source_root) / f'meta_data_{stage}').glob('*.json'))
        require(paths, f'Missing original metadata: meta_data_{stage}')
        date_supplements = {}
        date_files = {}
        if stage == 'pretrain':
            # This is the upstream input to the mapping pipeline. Newly added
            # dates need not wait for the scientific pipeline to be rerun.
            for path in sorted((Path(source_root) / 'data_summaries_pretrain').glob('*.json')):
                for identifier, record in read(path).items():
                    inferred = record.get('Inferred Metadata', {})
                    fields = {key: inferred[key] for key in ('Release Date', 'Publication Date', 'HF Date',
                              'Created At', 'Github Date', 'GitHub Date', 'S2 Date', 'PwC Date') if inferred.get(key)}
                    if fields:
                        key = (record.get('Collection'), identifier)
                        require(key not in date_supplements, f'Duplicate upstream date record: {key}')
                        date_supplements[key] = fields
                        date_files[key] = path
        for path in paths:
            hashes[f'meta_data_{stage}/{path.name}'] = sha(path)
            for identifier, record in read(path).items():
                name = record.get('Collection')
                require(isinstance(name, str) and name.strip(), f'Missing collection in {path.name}')
                group = grouped.setdefault(name, {})
                require(identifier not in group, f'Duplicate dataset ID in collection: {name}/{identifier}')
                key = (name, identifier)
                if key in date_supplements:
                    record = {**record, 'Inferred Metadata': {**record.get('Inferred Metadata', {}), **date_supplements[key]}}
                    date_path = date_files[key]
                    relative = f'data_summaries_pretrain/{date_path.name}'
                    if relative not in hashes:
                        hashes[relative] = sha(date_path)
                group[identifier] = record
        stages[stage] = {}
        for name, items in sorted(grouped.items(), key=lambda item: item[0].casefold()):
            records = list(items.values())
            dataset_links = []
            for field in ('Collection URL', 'Hugging Face URL', 'Dataset URL', 'GitHub URL'):
                links = sorted(set().union(*(web_links(r.get(field)) for r in records)))
                if links and not dataset_links:
                    dataset_links = links
                if len(links) == 1:
                    dataset_links = links
                    break
            paper_links = sorted(set().union(*(web_links(r.get(field)) for r in records
                                               for field in ('Paper URL', 'ArXiv URL', 'Article URL', 'DOI URL'))))
            quantities, languages, tasks, sources = [], set(), set(), set()
            missing_quantity = missing_languages = 0
            for record in records:
                value = record.get('Text Metrics', {}).get('Num Unicode Characters' if stage == 'pretrain' else 'Num Dialogs')
                if value is None:
                    missing_quantity += 1
                else:
                    require(isinstance(value, (float, int)) and math.isfinite(value) and value >= 0,
                            f'Invalid collection quantity: {name}')
                    quantities.append(value)
                labels = record.get('Languages', [])
                languages.update(label.strip() for label in labels if isinstance(label, str) and label.strip())
                missing_languages += not bool(labels)
                tasks.update(record.get('Task Macro Categories', []))
                sources.update(record.get('Text Source Categories', []))
            stages[stage][name] = {'name': name, 'dataset_count': len(records),
                'quantity': math.fsum(quantities) if quantities else None,
                'quantity_partial': bool(missing_quantity),
                'language_count': len(languages) if languages else None, 'language_labels': sorted(languages),
                'language_count_partial': bool(missing_languages),
                'tasks': sorted(tasks), 'sources': sorted(sources), **collection_date(records),
                'dataset_links': dataset_links, 'paper_links': paper_links}
    return {'schema_version': 'dataset-catalog/2', 'catalog_version': collection_version(stages, hashes),
            'sources_sha256': hashes, 'stages': stages}


def dataset_catalog(root):
    root = Path(root)
    manifest = read(root / 'data/manifest.json')
    metadata = read(root / 'data/collection-metadata.json')
    require(metadata.get('schema_version') == 'dataset-catalog/2',
            'Refresh the complete collection catalog with --collection-source-root.')
    require(metadata['catalog_version'] == collection_version(metadata['stages'], metadata['sources_sha256']),
            'Collection metadata checksum differs. Refresh with --collection-source-root.')
    stages = {}
    for stage, groups in metadata['stages'].items():
        stages[stage] = []
        for name, meta in sorted(groups.items(), key=lambda item: item[0].casefold()):
            for key in ('dataset_links', 'paper_links'):
                require(set(meta[key]) == web_links(meta[key]), f'Invalid collection URL: {name}')
            stages[stage].append(meta)
    return {'schema_version': metadata['schema_version'], 'catalog_version': metadata['catalog_version'], 'stages': stages,
            'task_names': {key: value['name'] for key, value in manifest['task_categories'].items()}}


def prepare_dataset_catalog(root, check=False):
    root = Path(root)
    payload = json.dumps(dataset_catalog(root), ensure_ascii=False, separators=(',', ':'), allow_nan=False)
    outputs = {'data/dataset-catalog.json': payload + '\n',
               'assets/static-data/dataset-catalog.js': f'globalThis.MappDatasetCatalog=JSON.parse({json.dumps(payload)});\n'}
    for relative, content in outputs.items():
        path = root / relative
        if check:
            require(path.is_file() and path.read_text(encoding='utf-8') == content,
                    f'Dataset catalog needs syncing: {relative}')
        else:
            path.write_text(content, encoding='utf-8', newline='\n')


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--check', action='store_true', help='Verify the page is synchronized, without modifying it')
    parser.add_argument('--metadata-source-root', type=Path,
                        help='Import the three Explorer fields from existing join_language_clusters.py CSV outputs')
    parser.add_argument('--collection-source-root', type=Path,
                        help='Import original meta_data_pretrain/posttrain records and upstream data_summaries_pretrain dates')
    args = parser.parse_args()
    try:
        portable_details(ROOT, check=args.check)
        points = profile_points(ROOT)
        points_file = ROOT / 'assets/resource-profile-points.json'
        index = ROOT / 'index.html'
        metadata_file = ROOT / 'data/explorer-filters.json'
        if args.metadata_source_root:
            metadata = json.dumps(import_filter_metadata(ROOT, args.metadata_source_root), ensure_ascii=False, separators=(',', ':'), allow_nan=False) + '\n'
            if args.check:
                require(metadata_file.is_file() and metadata_file.read_text(encoding='utf-8') == metadata, 'Filter metadata needs importing')
            else:
                metadata_file.write_text(metadata, encoding='utf-8', newline='\n')
        filter_metadata(ROOT)
        prepare_static_data(ROOT, check=args.check)
        if args.collection_source_root:
            metadata = json.dumps(import_collection_metadata(ROOT, args.collection_source_root), ensure_ascii=False,
                                  separators=(',', ':'), allow_nan=False) + '\n'
            path = ROOT / 'data/collection-metadata.json'
            if args.check:
                require(path.is_file() and path.read_text(encoding='utf-8') == metadata, 'Collection metadata needs importing')
            else:
                path.write_text(metadata, encoding='utf-8', newline='\n')
            print(f'Dataset Catalog: {"verified" if args.check else "refreshed"} source metadata, including upstream pre-training dates.')
        elif not args.check:
            print('Dataset Catalog: using saved data/collection-metadata.json. To import source changes, add --collection-source-root <research repository>.')
        prepare_dataset_catalog(ROOT, check=args.check)
        html = prepared_html(ROOT)
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
