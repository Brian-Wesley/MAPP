"""Manually regenerate the first website figure from the current data/ snapshot.

Run in Anaconda Prompt (base), from the MAPP directory:
    python -B scripts/update_resource_profiles.py --source-root D:/Projects/low-resource-language-review

Use --check to validate without writing; --verify to check a previous export.
Default outputs: assets/language_resource_profiles.{png,svg,pdf} and an audit JSON.
Other paper figures and tables are deliberately outside this script's scope.
Requires matplotlib, numpy and pandas. It imports the renderer used by
plot_results.py, but never invokes that script or reads its raw research data.
"""

import argparse
from collections import Counter
from datetime import datetime, timezone
import hashlib
import importlib.util
import json
import math
import os
from pathlib import Path
import re
import sys
import tempfile


ROOT = Path(__file__).resolve().parents[1]
STEM = "language_resource_profiles"
RENDERER_PATH = "intro_figures/plot_figure2.py"
REGIME_IDS = ("expand-pre-training", "bootstrap-post-training", "scale-up-post-training",
              "diversify-post-training", "refine-both-stages")
sys.dont_write_bytecode = True


def digest(raw):
    return hashlib.sha256(raw).hexdigest()


def require(condition, message):
    if not condition:
        raise ValueError(message)


class Snapshot:
    def __init__(self, folder):
        self.folder = Path(folder).resolve()
        self.hashes = {}

    def read(self, relative):
        requested = self.folder / relative
        reserved = re.fullmatch(r'(con|prn|aux|nul|com[1-9]|lpt[1-9])\.json', requested.name, re.I)
        # Do not resolve a reserved basename through the Windows device namespace.
        path = requested.parent.resolve() / requested.name if reserved else requested.resolve()
        require(path.is_relative_to(self.folder) and path.suffix == '.json', "Invalid snapshot path")
        if reserved:
            portable = path.with_name(f'iso-{path.name}')
            if portable.is_file():
                path = portable
        filename = '\\\\?\\' + str(path) if os.name == 'nt' else str(path)
        with open(filename, 'rb') as handle:
            raw = handle.read()
        self.hashes[path.relative_to(self.folder).as_posix()] = digest(raw)
        return json.loads(raw.decode('utf-8-sig'))

    def check_unchanged(self):
        for relative, expected in self.hashes.items():
            require(digest((self.folder / relative).read_bytes()) == expected,
                    f"Data changed during export: {relative}. Run again after updating data/.")


def load_renderer(source_root, manifest):
    path = Path(source_root).resolve() / RENDERER_PATH
    sha = digest(path.read_bytes())
    # The upstream exporter hashes sorted 'relative/path:sha256' entries per folder.
    fingerprint = {'files': 1, 'sha256': digest(f'{RENDERER_PATH}:{sha}'.encode('utf-8'))}
    require(manifest.get('inputs', {}).get('intro_figures') == fingerprint,
            'The plotting source differs from the data export. Export data/ again using '
            'the matching pipeline version, or use the matching --source-root.')
    import matplotlib
    matplotlib.use('Agg')
    spec = importlib.util.spec_from_file_location('mapp_resource_profile_renderer', path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module, sha


def prepare(data_dir, source_root):
    snapshot = Snapshot(data_dir)
    manifest = snapshot.read('manifest.json')
    require(manifest.get('schema_version') == 'language-resource-explorer/1', 'Unsupported data schema')
    require(isinstance(manifest.get('data_version'), str) and manifest['data_version'], 'Missing data version')
    rows = snapshot.read(manifest['files']['index'])
    clusters = snapshot.read(manifest['files']['clusters'])
    require(len(rows) == manifest['language_count'], 'Index/manifest count mismatch')
    renderer, renderer_sha = load_renderer(source_root, manifest)
    definitions = {group['id']: group for group in clusters['regimes']}
    for ident, (_, pairs) in zip(REGIME_IDS, renderer.SEMANTIC_GROUPS):
        require({tuple(pair) for pair in definitions[ident]['cluster_pairs']} == set(pairs),
                f'Plot/export regime mismatch: {ident}')

    by_code, records, omitted = {}, [], []
    for row in rows:
        code = row['code']
        require(re.fullmatch('[a-z]{3}', code) and code not in by_code, 'Invalid or duplicate language code')
        by_code[code] = row
        for stage in ('pretrain', 'posttrain'):
            value = row[stage]
            require(value['cluster'] in (-1, 0, 1, 2), f'{code}: unknown saved cluster')
            if value['cluster'] == -1:
                require(value['quantity'] is None and value['status'] in ('uncovered', 'quantity_unavailable'),
                        f'{code}: unusable quantity/status mismatch')
            else:
                require(isinstance(value['quantity'], (int, float)) and math.isfinite(value['quantity'])
                        and value['quantity'] > 0 and value['status'] == 'clustered',
                        f'{code}: invalid usable quantity/status')
        pair = (row['pretrain']['cluster'], row['posttrain']['cluster'])
        require(row['regime'] in definitions, f'{code}: unknown saved regime')
        require(row['regime'] == 'other' or list(pair) in definitions[row['regime']]['cluster_pairs'],
                f'{code}: regime/pair mismatch')
        reason = ('no_usable_pretraining_quantity' if pair[0] == -1 else
                  'pair_excluded_by_paper_renderer' if pair not in renderer.PAIR_ORDER else None)
        if reason:
            omitted.append({'code': code, 'pair': list(pair), 'regime': row['regime'], 'reason': reason})
            continue
        records.append({'code': code, 'pre_cluster': pair[0], 'post_cluster': pair[1], 'pair': pair,
                        'log_pre': math.log10(row['pretrain']['quantity']),
                        'log_post': math.log10(row['posttrain']['quantity']) if pair[1] >= 0 else float('nan')})
    for stage in ('pretrain', 'posttrain'):
        counts = Counter(row[stage]['cluster'] for row in rows)
        require(counts == Counter({group['cluster']: group['n_languages'] for group in clusters[stage]}),
                f'{stage}: exported cluster totals disagree with the index')
    for ident, group in definitions.items():
        require(sum(row['regime'] == ident for row in rows) == group['n_languages'],
                f'{ident}: exported regime total disagrees with the index')
    require(records and any(row['post_cluster'] >= 0 for row in records),
            'The paper renderer requires both a nonempty plot and at least one measured post-training point')
    require(all(row['log_pre'] >= 0 for row in records),
            'Some NCC values are below 1; the paper renderer starts x at 0 and would clip them. Adjust its axis first.')
    points = renderer.pd.DataFrame.from_records(records).set_index('code')
    examples = renderer.choose_examples(points)
    intervals, warnings = {}, []
    for code in [code for group in examples.values() for code in group]:
        row = by_code[code]
        detail = snapshot.read(row['details'])
        require(detail['code'] == code and detail['regime'] == row['regime'], f'{code}: detail identity mismatch')
        for stage in ('pretrain', 'posttrain'):
            require(all(detail[stage][key] == row[stage][key] for key in ('cluster', 'status', 'quantity')),
                    f'{code}: details do not match the index')
        bounds = detail['pretrain'].get('quantity_ci95') or {}
        lower, upper, quantity = bounds.get('lower'), bounds.get('upper'), row['pretrain']['quantity']
        valid = all(isinstance(value, (int, float)) and math.isfinite(value) for value in (lower, upper))
        if valid and 0 < lower <= quantity <= upper:
            intervals[code] = {'quantity': quantity, 'lower': lower, 'upper': upper}
        else:
            intervals[code] = None
            warnings.append(f'{code}: no valid NCC confidence interval; its point will still be plotted')
    excluded = sum(row['reason'] == 'pair_excluded_by_paper_renderer' for row in omitted)
    if excluded:
        warnings.append(f'{excluded} languages have pairs excluded by the paper renderer; see omitted_languages')
    registry = {row['code']: {'English_Name': [row['name']]} for row in rows}
    return dict(snapshot=snapshot, manifest=manifest, clusters=clusters, rows=by_code, renderer=renderer,
                renderer_sha=renderer_sha, points=points, examples=examples, intervals=intervals,
                registry=registry, omitted=omitted, warnings=warnings)


def build_audit(prepared, selected):
    renderer, points = prepared['renderer'], prepared['points']
    languages = []
    for code, point in points.iterrows():
        row = prepared['rows'][code]
        missing = int(point.post_cluster) == -1
        languages.append({'code': code, 'name': row['name'], 'regime': row['regime'],
                          'pretrain_cluster': int(point.pre_cluster), 'posttrain_cluster': int(point.post_cluster),
                          'NCC': row['pretrain']['quantity'], 'sample_equivalents': row['posttrain']['quantity'],
                          'x_log10_NCC': float(point.log_pre),
                          'y_log10_samples': None if missing else float(point.log_post),
                          'panel': 'categorical_strip' if missing else 'measured',
                          'categorical_jitter': renderer.stable_missing_jitter(code) if missing else None})
    return {
        'schema_version': 'mapp-resource-profile-audit/1',
        'data_version': prepared['manifest']['data_version'],
        'generated_at': datetime.now(timezone.utc).isoformat(),
        'data_files_sha256': dict(prepared['snapshot'].hashes),
        'renderer': {'path': RENDERER_PATH, 'sha256': prepared['renderer_sha']},
        'update_script_sha256': digest(Path(__file__).read_bytes()),
        'language_count': len(prepared['rows']), 'plotted_count': len(languages),
        'pair_counts': {f'{pre},{post}': count for (pre, post), count in Counter(points.pair).items()},
        'regime_counts': dict(Counter(row['regime'] for row in prepared['rows'].values())),
        'plotted_languages': languages, 'omitted_languages': prepared['omitted'],
        'labelled_languages': selected,
        'semantics': {
            'points': 'One record per ISO 639-3; no merging or deduplication of coincident positions. Highlight overlays are not additional languages.',
            'coordinates': 'log10(NCC), log10(sample equivalents); no power transform.',
            'missing': 'Pre-training cluster -1 is omitted. Post-training cluster -1 uses a categorical strip; jitter is not quantity.',
            'clusters': 'Saved index labels and regimes, never recomputed from quantity thresholds.',
            'intervals': 'Original paper display expansion in log10 space. Display endpoints are not true 95% confidence bounds.',
        },
        'ci_display_scale': renderer.NCC_CI_DISPLAY_SCALE,
        'ci_display_scale_overrides': renderer.NCC_CI_DISPLAY_SCALE_OVERRIDES,
        'warnings': prepared['warnings'],
    }


def write_outputs(prepared, output_dir, formats, dpi):
    output_dir = Path(output_dir).resolve()
    require(not output_dir.is_relative_to(prepared['snapshot'].folder), 'Output directory must be outside data/')
    renderer = prepared['renderer']
    figure, selected, _ = renderer.create_resource_profile_figure(
        prepared['points'], prepared['examples'], prepared['registry'], pretraining_ci=prepared['intervals'])
    try:
        output_dir.mkdir(parents=True, exist_ok=True)
        # Render everything before replacing existing assets. Publish the audit last.
        with tempfile.TemporaryDirectory(prefix='.resource-profiles-', dir=output_dir) as folder:
            folder = Path(folder)
            audit = build_audit(prepared, selected)
            audit['outputs_sha256'] = {}
            for extension in formats:
                filename = f'{STEM}.{extension}'
                figure.savefig(folder / filename, dpi=dpi, facecolor='white')
                audit['outputs_sha256'][filename] = digest((folder / filename).read_bytes())
            audit_name = f'{STEM}_audit.json'
            (folder / audit_name).write_text(json.dumps(audit, ensure_ascii=False, indent=2, allow_nan=False) + '\n', encoding='utf-8')
            prepared['snapshot'].check_unchanged()
            for filename in [*audit['outputs_sha256'], audit_name]:
                (folder / filename).replace(output_dir / filename)
                print(f'Saved: {output_dir / filename}')
    finally:
        renderer.plt.close(figure)


def verify_outputs(prepared, output_dir):
    output_dir = Path(output_dir)
    audit = json.loads((output_dir / f'{STEM}_audit.json').read_text(encoding='utf-8'))
    require(audit['data_version'] == prepared['manifest']['data_version'], 'Figure/data versions differ; regenerate the figure')
    require(audit['renderer']['sha256'] == prepared['renderer_sha'], 'Figure renderer has changed')
    # The audit retains the updater hash used at generation time. Updater-only
    # changes (such as portable filenames) do not invalidate unchanged inputs,
    # the verified renderer, or the output file checksums.
    require(audit['data_files_sha256'] == prepared['snapshot'].hashes, 'Figure input hashes differ; regenerate the figure')
    for filename, expected in audit['outputs_sha256'].items():
        require(Path(filename).name == filename, 'Invalid audit output filename')
        require(digest((output_dir / filename).read_bytes()) == expected, f'Figure file changed: {filename}')
    print(f'Verified {len(audit["outputs_sha256"])} figure files against data version {audit["data_version"]}.')


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--source-root', required=True, type=Path, help='Research repository containing plot_results.py')
    parser.add_argument('--data-dir', type=Path, default=ROOT / 'data')
    parser.add_argument('--output-dir', type=Path, default=ROOT / 'assets')
    parser.add_argument('--formats', nargs='+', choices=('png', 'svg', 'pdf'), default=['png', 'svg', 'pdf'])
    parser.add_argument('--dpi', type=int, default=300)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument('--check', action='store_true', help='Validate inputs without writing files')
    mode.add_argument('--verify', action='store_true', help='Check previously generated images and audit against current data')
    args = parser.parse_args(argv)
    if args.dpi <= 0:
        parser.error('--dpi must be positive')
    try:
        prepared = prepare(args.data_dir, args.source_root)
        print(f'Data version: {prepared["manifest"]["data_version"]}; indexed: {len(prepared["rows"]):,}; '
              f'plotted: {len(prepared["points"]):,}; omitted: {len(prepared["omitted"]):,}')
        for warning in prepared['warnings']:
            print(f'Warning: {warning}')
        print('Note: highlighted NCC intervals retain the paper renderer\'s illustrative 2x/5x/10x log-space expansion.')
        if args.verify:
            verify_outputs(prepared, args.output_dir)
        elif not args.check:
            write_outputs(prepared, args.output_dir, list(dict.fromkeys(args.formats)), args.dpi)
        prepared['snapshot'].check_unchanged()
        return 0
    except (OSError, ValueError, KeyError, TypeError, ImportError) as error:
        print(f'Error: {error}', file=sys.stderr)
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
