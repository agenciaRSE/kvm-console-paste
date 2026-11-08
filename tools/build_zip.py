"""Build the Chrome Web Store zip: python tools/build_zip.py

Packs only what the extension loads, after checking that every file the
manifest, popup and content-script registrations reference exists, that all
JSON parses and that every i18n key used exists in every locale.
"""
import json
import re
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
INCLUDE = ['manifest.json', 'background.js', 'content.js', 'page-inject.js',
           'popup.html', 'popup.css', 'popup.js', 'lib', 'icons', '_locales', 'LICENSE']


def fail(msg):
    sys.exit(f'ERROR: {msg}')


manifest = json.loads((ROOT / 'manifest.json').read_text(encoding='utf-8'))
version = manifest['version']

# Files referenced from manifest, popup and the dynamic registrations.
refs = set(manifest['icons'].values()) | set(manifest['action']['default_icon'].values())
refs |= {manifest['action']['default_popup'], manifest['background']['service_worker']}
for src in ['popup.html', 'background.js', 'lib/sites.js', 'popup.js']:
    text = (ROOT / src).read_text(encoding='utf-8')
    refs |= set(re.findall(r"""(?:src|href)="([\w./-]+\.(?:js|css))\"""", text))
    refs |= set(re.findall(r"""['"]((?:lib/)?[\w-]+\.js)['"]""", text))
    refs |= set(re.findall(r"""importScripts\('([\w./-]+)'\)""", text))
missing = sorted(r for r in refs if not (ROOT / r).is_file())
if missing:
    fail(f'missing files: {missing}')

# i18n: every key used exists in every locale.
locales = {p.parent.name: json.loads(p.read_text(encoding='utf-8')) for p in (ROOT / '_locales').glob('*/messages.json')}
if manifest.get('default_locale') not in locales:
    fail('default_locale has no messages.json')
used = set()
for src in ['manifest.json', 'popup.html', 'popup.js', 'content.js', 'background.js']:
    text = (ROOT / src).read_text(encoding='utf-8')
    used |= set(re.findall(r'__MSG_(\w+)__', text))
    used |= set(re.findall(r'data-i18n(?:-placeholder|-label)?="(\w+)"', text))
    used |= set(re.findall(r"\bt\('(\w+)'", text))
    used |= set(re.findall(r"getMessage\('(\w+)'", text))
for lang, msgs in locales.items():
    if used - msgs.keys():
        fail(f'{lang}: missing keys {sorted(used - msgs.keys())}')
for key in ('extName', 'extDescription'):
    for lang, msgs in locales.items():
        limit = 45 if key == 'extName' else 132
        if len(msgs[key]['message']) > limit:
            fail(f'{lang}.{key} longer than {limit} chars')

files = []
for item in INCLUDE:
    path = ROOT / item
    files += sorted(p for p in path.rglob('*') if p.is_file()) if path.is_dir() else [path]
for p in files:
    if p.suffix in {'.js', '.json', '.html', '.css'} and p.read_bytes().startswith(b'\xef\xbb\xbf'):
        fail(f'BOM in {p.relative_to(ROOT)}')

out = ROOT / 'dist' / f'kvm-console-paste-{version}.zip'
out.parent.mkdir(exist_ok=True)
with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED) as z:
    for p in files:
        z.write(p, p.relative_to(ROOT).as_posix())

print(f'{manifest["author"]} - version {version}')
print(f'{len(files)} files -> {out.relative_to(ROOT).as_posix()} ({out.stat().st_size // 1024} KB)')
for p in files:
    print('  ' + p.relative_to(ROOT).as_posix())
