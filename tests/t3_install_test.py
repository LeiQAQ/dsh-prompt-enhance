import hashlib
import importlib.util
import json
import pathlib
import plistlib
import struct
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('t3_install', pathlib.Path(__file__).parents[1] / 'adapters/t3/install.py')
installer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(installer)


class InstallerTest(unittest.TestCase):
    def test_patch_preserves_archive_layout_and_updates_both_integrity_layers(self):
        content = ('<html>\n' + ' ' * 600 + '<body><div id="root"></div></body></html>').encode()
        digest = hashlib.sha256(content).hexdigest()
        entry = {'size': len(content), 'offset': '0', 'integrity': {'algorithm': 'SHA256', 'hash': digest, 'blockSize': 4194304, 'blocks': [digest]}}
        tree = entry
        for name in reversed(installer.ENTRY.split('/')):
            tree = {'files': {name: tree}}
        raw = json.dumps(tree, separators=(',', ':')).encode()
        padded = raw + b'\0' * ((4 - len(raw) % 4) % 4)
        header_size = len(padded) + 8
        payload = struct.pack('<IIII', 4, header_size, header_size - 4, len(raw)) + padded + content + b'UNCHANGED-SIBLING'
        with tempfile.TemporaryDirectory() as directory:
            archive = pathlib.Path(directory) / 'app.asar'
            plist = pathlib.Path(directory) / 'Info.plist'
            archive.write_bytes(payload)
            plist.write_bytes(plistlib.dumps({'ElectronAsarIntegrity': {'Resources/app.asar': {'hash': hashlib.sha256(raw).hexdigest(), 'algorithm': 'SHA256'}}}))
            before = installer.read_entry(archive)
            installer.patch_archive(archive, plist, 18766)
            after = installer.read_entry(archive)
            self.assertEqual(before[2], after[2])
            self.assertEqual(len(before[3]), len(after[3]))
            self.assertEqual(len(payload), archive.stat().st_size)
            self.assertTrue(archive.read_bytes().endswith(b'UNCHANGED-SIBLING'))
            self.assertIn(b'miaobi-t3', after[3])
            self.assertEqual(plistlib.loads(plist.read_bytes())['ElectronAsarIntegrity']['Resources/app.asar']['hash'], hashlib.sha256(after[0]).hexdigest())
            with self.assertRaisesRegex(RuntimeError, 'already installed'):
                installer.patch_archive(archive, plist, 18766)

    def test_unknown_html_is_not_modified(self):
        with self.assertRaisesRegex(RuntimeError, 'Unknown T3'):
            installer.make_html(b'<html>unknown</html>', 18766)


if __name__ == '__main__':
    unittest.main()
