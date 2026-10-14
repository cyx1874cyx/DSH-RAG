"""Prepare local literature assets without publishing copyrighted PDFs or notes."""
import argparse
import hashlib
import json
from pathlib import Path
import re
import shutil
import sys
import zipfile

sys.stdout.reconfigure(encoding='utf-8', line_buffering=True)
parser = argparse.ArgumentParser()
parser.add_argument('--catalog', required=True, type=Path)
parser.add_argument('--output', required=True, type=Path)
parser.add_argument('--supplements', type=Path)
parser.add_argument('--thesis', type=Path)
args = parser.parse_args()
args.output.mkdir(parents=True, exist_ok=True)
catalog = json.loads(args.catalog.read_text(encoding='utf-8-sig'))
papers = catalog['papers']
files = []
duplicates = []
seen = {}

def digest(path):
    with path.open('rb') as handle:
        return hashlib.file_digest(handle, 'sha256').hexdigest()

def safe_name(title):
    return re.sub(r'[<>:"/\\|?*\x00-\x1f]', '_', title).strip(' .')[:110]

def add_file(source, relative, role, paper_id, title):
    sha = digest(source)
    if sha in seen:
        duplicates.append({'source': str(source), 'same_as': seen[sha], 'sha256': sha})
        return None
    target = args.output / relative
    target.parent.mkdir(parents=True, exist_ok=True)
    if not target.exists() or digest(target) != sha:
        shutil.copy2(source, target)
    seen[sha] = relative.as_posix()
    item = {'path': relative.as_posix(), 'source': str(source), 'sha256': sha, 'role': role, 'paper_id': paper_id, 'title': title}
    files.append(item)
    return item

labels = {'kind': '材料类型', 'stage': '研究阶段', 'sample': '样本', 'target': '检测对象', 'protocol': '方法与参数', 'reference': '参考标准', 'results': '已有精读结论', 'negative': '阴性结果', 'validation': '验证情况', 'limits': '局限与适用范围', 'anchors': '原文位置记录', 'use': '写作使用建议'}
for i, paper in enumerate(papers, 1):
    gid = paper['gid']
    title = paper['title']
    original = Path(paper['pdf']) if paper.get('pdf') else None
    file_info = None
    if original is not None and original.is_file():
        file_info = add_file(original, Path('原文') / (gid + '_' + safe_name(title) + '.pdf'), 'original', gid, title)
    note_role = 'reading_note' if file_info is not None else 'metadata_note'
    note_folder = '精读笔记' if note_role == 'reading_note' else '题录资料'
    note_path = Path(note_folder) / (gid + '_' + safe_name(title) + '.md')
    body = [f'# {gid} {title}', '', '> 本文件为既有研究笔记或题录记录，不是论文原文。原文位置记录需要返回 PDF 核对。', '', f'文献编号：{gid}', f'标题：{title}', '作者：' + '; '.join(paper.get('authors', [])), '年份：' + str(paper.get('year', '')), '期刊：' + paper.get('journal', ''), 'DOI：' + paper.get('doi', ''), '技术类别：' + ', '.join(paper.get('module_all', [paper.get('module', '')]))]
    if paper.get('url'):
        body.append('来源链接：' + paper['url'])
    if file_info:
        body.append('本地原文：../' + file_info['path'])
    elif original is not None:
        body.append('原文状态：现有题录中的 PDF 路径不可访问。')
    else:
        body.append('原文状态：目前仅有题录、摘要或网页核验记录，无本地 PDF。')
    unique = set()
    for record in paper.get('evidence_records', [paper]):
        signature = json.dumps({k: record.get(k, '') for k in labels}, ensure_ascii=False, sort_keys=True)
        if signature in unique:
            continue
        unique.add(signature)
        body.extend(['', '## 既有记录 ' + record.get('alias', gid)])
        for key, label in labels.items():
            if record.get(key):
                body.extend(['', f'### {label}', str(record[key])])
    note_target = args.output / note_path
    note_target.parent.mkdir(parents=True, exist_ok=True)
    note_target.write_text('\n'.join(body) + '\n', encoding='utf-8')
    files.append({'path': note_path.as_posix(), 'source': str(args.catalog), 'sha256': digest(note_target), 'role': note_role, 'paper_id': gid, 'title': title})
    if i % 30 == 0:
        print(f'Canonical literature prepared: {i}/{len(papers)}')

if args.supplements and args.supplements.is_file():
    with zipfile.ZipFile(args.supplements) as archive:
        supplement_number = 0
        for entry in archive.infolist():
            name = Path(entry.filename).name
            if not re.search(r'\bSI\b', name) or Path(name).suffix.lower() not in ('.pdf', '.docx'):
                continue
            supplement_number += 1
            target = args.output / '补充材料' / ('SI%02d_' % supplement_number + name)
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(archive.read(entry))
            tokens = set(re.findall(r'[a-z]{4,}', name.lower()))
            ranked = sorted(papers, key=lambda p: len(tokens & set(re.findall(r'[a-z]{4,}', p['title'].lower()))), reverse=True)
            parent = ranked[0]['gid'] if ranked and len(tokens & set(re.findall(r'[a-z]{4,}', ranked[0]['title'].lower()))) >= 3 else None
            files.append({'path': target.relative_to(args.output).as_posix(), 'source': str(args.supplements) + '::' + entry.filename, 'sha256': digest(target), 'role': 'supplement', 'paper_id': parent, 'title': name})
if args.thesis and args.thesis.is_file():
    add_file(args.thesis, Path('学位论文') / args.thesis.name, 'thesis', 'THESIS01', args.thesis.stem)

metadata = {'schema_version': 1, 'source_catalog': str(args.catalog), 'papers': papers, 'files': files, 'duplicates': duplicates, 'counts': {'papers': len(papers), 'original_pdfs': sum(f['role'] == 'original' for f in files), 'reading_notes': sum(f['role'] == 'reading_note' for f in files), 'metadata_notes': sum(f['role'] == 'metadata_note' for f in files), 'supplements': sum(f['role'] == 'supplement' for f in files), 'theses': sum(f['role'] == 'thesis' for f in files)}}
(args.output / 'literature-manifest.json').write_text(json.dumps(metadata, ensure_ascii=False, indent=2), encoding='utf-8')
print('Local corpus prepared:', json.dumps(metadata['counts'], ensure_ascii=False))
