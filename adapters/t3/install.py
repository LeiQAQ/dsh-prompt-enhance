#!/usr/bin/env python3
"""Reversible macOS adapter for the locally installed, ad-hoc-signed T3 build.

Only the existing index.html bytes and their fixed-length integrity hashes are
patched. Every ASAR file offset stays unchanged, including for running processes.
No debugger port, credentials, Electron fuses or security policies are changed.
"""
import argparse
import hashlib
import json
import os
import pathlib
import plistlib
import re
import secrets
import shutil
import struct
import subprocess
import time

HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parent.parent
STATE = pathlib.Path.home() / '.t3' / 'miaobi'
APP = pathlib.Path('/Applications/T3 Code (Beta).app')
AGENT = pathlib.Path.home() / 'Library/LaunchAgents/com.leiyu.miaobi-t3.plist'
ENTRY = 'apps/server/dist/client/index.html'
MARKER = '<!-- miaobi-t3 -->'


def digest(data):
    return hashlib.sha256(data).hexdigest()


def read_entry(archive):
    with archive.open('rb') as handle:
        handle.seek(4)
        header_size = struct.unpack('<I', handle.read(4))[0]
        handle.seek(12)
        json_size = struct.unpack('<I', handle.read(4))[0]
        raw = handle.read(json_size)
        entry = json.loads(raw)
        for part in ENTRY.split('/'):
            entry = entry['files'][part]
        offset = 8 + header_size + int(entry['offset'])
        handle.seek(offset)
        content = handle.read(entry['size'])
    if digest(content) != entry['integrity']['hash']:
        raise RuntimeError('T3 index integrity mismatch; refusing to modify it')
    return raw, entry, offset, content


def make_html(content, port):
    html = content.decode('utf-8')
    if MARKER in html:
        raise RuntimeError('Miaobi is already installed')
    if 'data-testid' not in html and '<div id="root">' not in html:
        raise RuntimeError('Unknown T3 HTML entry point')
    # Remove indentation only, leaving boot recovery scripts and styles intact.
    html = re.sub(r'\n[ \t]+', '\n', html)
    bootstrap = MARKER + '''<script>(()=>{let n=0;function load(){fetch("http://127.0.0.1:PORT/client.js").then(r=>{if(!r.ok)throw Error();return r.text()}).then(t=>{let s=document.createElement("script");s.textContent=t;document.body.append(s);s.remove()}).catch(()=>{if(++n<24)setTimeout(load,5000)})}load()})()</script>'''.replace('PORT', str(port))
    html = html.replace('</body>', bootstrap + '</body>')
    result = html.encode('utf-8')
    if len(result) > len(content):
        raise RuntimeError('No room for a fixed-size HTML patch')
    return result + b' ' * (len(content) - len(result))


def patch_archive(archive, plist_path, port):
    raw, entry, offset, content = read_entry(archive)
    plist = plistlib.loads(plist_path.read_bytes())
    expected = plist['ElectronAsarIntegrity']['Resources/app.asar']['hash']
    if digest(raw) != expected:
        raise RuntimeError('T3 ASAR header integrity mismatch')
    updated = make_html(content, port)
    old_hash = digest(content).encode()
    new_header = raw.replace(old_hash, digest(updated).encode())
    if len(raw) != len(new_header) or raw == new_header:
        raise RuntimeError('Cannot preserve ASAR header layout')
    # Keep node size, offsets and header allocation exactly as installed.
    with archive.open('r+b') as handle:
        handle.seek(offset)
        handle.write(updated)
        handle.seek(16)
        handle.write(new_header)
        handle.flush()
        os.fsync(handle.fileno())
    plist['ElectronAsarIntegrity']['Resources/app.asar']['hash'] = digest(new_header)
    plist_path.write_bytes(plistlib.dumps(plist))
    return {'originalHtmlSha256': digest(content), 'installedHtmlSha256': digest(updated)}


def launch(*args, check=True):
    return subprocess.run(list(args), check=check, capture_output=True, text=True)


def uninstall():
    record = json.loads((STATE / 'installation.json').read_text())
    backup = pathlib.Path(record['backup'])
    archive = APP / 'Contents/Resources/app.asar'
    if digest(read_entry(archive)[3]) != record['installedHtmlSha256']:
        raise RuntimeError('T3 changed since installation; refusing to overwrite an updated app')
    launch('launchctl', 'bootout', f'gui/{os.getuid()}', str(AGENT), check=False)
    for relative in record['backedUpFiles']:
        shutil.copy2(backup / relative, APP / relative)
    AGENT.unlink(missing_ok=True)
    (STATE / 'installation.json').rename(STATE / 'uninstalled.json')
    print('Uninstalled. Reload T3 to remove the button. Backups retained at', backup)


def install(port):
    STATE.mkdir(parents=True, exist_ok=True)
    os.chmod(STATE, 0o700)
    if (STATE / 'installation.json').exists():
        raise RuntimeError('Already installed; uninstall before reinstalling')
    signature = launch('codesign', '-dv', str(APP)).stderr
    if 'Signature=adhoc' not in signature:
        raise RuntimeError('This installer supports only an ad-hoc-signed local T3 build')
    archive = APP / 'Contents/Resources/app.asar'
    plist_path = APP / 'Contents/Info.plist'
    original = read_entry(archive)[3]
    make_html(original, port)  # Validate compatibility before any writes.
    binary = shutil.which('codex')
    node = shutil.which('node')
    if not binary or not node:
        raise RuntimeError('Node 22+ and Codex CLI are required')
    config = {'token': secrets.token_hex(32), 'port': port, 'model': 'gpt-6.1-sol', 'codexPath': binary}
    config_path = STATE / 'config.json'
    config_path.write_text(json.dumps(config, indent=2) + '\n')
    os.chmod(config_path, 0o600)
    launch_config = {
        'Label': 'com.leiyu.miaobi-t3',
        'ProgramArguments': [node, str(HERE / 'service.mjs'), str(config_path)],
        'RunAtLoad': True, 'KeepAlive': True, 'ThrottleInterval': 10,
        'WorkingDirectory': str(ROOT),
        'EnvironmentVariables': {'PATH': str(pathlib.Path(node).parent) + ':' + str(pathlib.Path(binary).parent) + ':/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin', 'HOME': str(pathlib.Path.home())},
        'StandardOutPath': str(STATE / 'service.log'), 'StandardErrorPath': str(STATE / 'service-error.log'),
    }
    backup = STATE / 'backups' / time.strftime('%Y%m%d-%H%M%S')
    relatives = ['Contents/Resources/app.asar', 'Contents/Info.plist', 'Contents/MacOS/T3 Code (Beta)', 'Contents/_CodeSignature/CodeResources']
    for relative in relatives:
        target = backup / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(APP / relative, target)
    try:
        info = patch_archive(archive, plist_path, port)
        launch('codesign', '--force', '--sign', '-', '--preserve-metadata=identifier,entitlements,flags,runtime', str(APP))
        launch('codesign', '--verify', str(APP))
        AGENT.parent.mkdir(parents=True, exist_ok=True)
        AGENT.write_bytes(plistlib.dumps(launch_config))
        launch('launchctl', 'bootstrap', f'gui/{os.getuid()}', str(AGENT))
    except BaseException:
        launch('launchctl', 'bootout', f'gui/{os.getuid()}', str(AGENT), check=False)
        for relative in relatives:
            shutil.copy2(backup / relative, APP / relative)
        raise
    record = {**info, 'backup': str(backup), 'backedUpFiles': relatives, 'version': '0.1.0', 'sourceRoot': str(ROOT), 'port': port}
    (STATE / 'installation.json').write_text(json.dumps(record, indent=2) + '\n')
    print('Installed Miaobi for T3. Local service:', f'http://127.0.0.1:{port}')
    print('Backups:', backup)
    print('Reload T3 once to activate the composer button.')


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--uninstall', action='store_true')
    parser.add_argument('--port', type=int, default=18766)
    args = parser.parse_args()
    if args.uninstall:
        uninstall()
    else:
        install(args.port)
