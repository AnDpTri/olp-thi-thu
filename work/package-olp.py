import json
from pathlib import Path
from xml.etree.ElementTree import Element, SubElement, tostring
from zipfile import ZIP_DEFLATED, ZipFile

base = Path(__file__).resolve().parent
source = base / 'olp-vscode'
package = json.loads((source / 'package.json').read_text(encoding='utf-8'))
output = base.parent / 'outputs' / f"olp-thi-thu-{package['version']}.vsix"

manifest = Element('PackageManifest', Version='2.0.0', xmlns='http://schemas.microsoft.com/developer/vsx-schema/2011')
metadata = SubElement(manifest, 'Metadata')
SubElement(metadata, 'Identity', Id=package['name'], Version=package['version'],
           Language='vi-VN', Publisher=package['publisher'])
SubElement(metadata, 'DisplayName').text = package['displayName']
SubElement(metadata, 'Description').text = package['description']
SubElement(metadata, 'Categories').text = 'Other'
properties = SubElement(metadata, 'Properties')
SubElement(properties, 'Property', Id='Microsoft.VisualStudio.Code.Engine', Value=package['engines']['vscode'])
if (source / 'node_modules' / '@napi-rs' / 'canvas-win32-x64-msvc').is_dir():
    metadata.find('Identity').set('TargetPlatform', 'win32-x64')
targets = SubElement(manifest, 'Installation')
SubElement(targets, 'InstallationTarget', Id='Microsoft.VisualStudio.Code')
assets = SubElement(manifest, 'Assets')
SubElement(assets, 'Asset', Type='Microsoft.VisualStudio.Code.Manifest',
           Path='extension/package.json', Addressable='true')
SubElement(assets, 'Asset', Type='Microsoft.VisualStudio.Services.Content.Details',
           Path='extension/README.md', Addressable='true')

content = Element('Types', xmlns='http://schemas.openxmlformats.org/package/2006/content-types')
for extension, content_type in {
    'vsixmanifest': 'text/xml', 'json': 'application/json', 'js': 'text/javascript',
    'md': 'text/markdown', 'svg': 'image/svg+xml', 'mjs': 'text/javascript',
    'py': 'text/x-python', 'css': 'text/css', 'bcmap': 'application/octet-stream', 'ttf': 'font/ttf',
    'pfb': 'application/octet-stream',
    'node': 'application/octet-stream', 'dat': 'application/octet-stream', 'ts': 'text/plain',
}.items():
    SubElement(content, 'Default', Extension=extension, ContentType=content_type)
for file in source.rglob('*'):
    if file.is_file() and not file.suffix:
        SubElement(content, 'Override', PartName='/extension/' + file.relative_to(source).as_posix(),
                   ContentType='text/plain')

with ZipFile(output, 'w', ZIP_DEFLATED) as bundle:
    bundle.writestr('extension.vsixmanifest', tostring(manifest, encoding='utf-8', xml_declaration=True))
    bundle.writestr('[Content_Types].xml', tostring(content, encoding='utf-8', xml_declaration=True))
    for file in sorted(source.rglob('*')):
        if file.is_file():
            bundle.write(file, 'extension/' + file.relative_to(source).as_posix())
with ZipFile(output) as bundle:
    assert bundle.testzip() is None
print(output)
