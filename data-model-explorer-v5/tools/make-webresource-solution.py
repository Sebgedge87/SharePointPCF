#!/usr/bin/env python3
"""Package Data_Model_Explorer.html as a web resource in an unmanaged Dataverse solution.

  python3 tools/make-webresource-solution.py                       # uses dist/Data_Model_Explorer.html, publisher FORMUS / formus
  python3 tools/make-webresource-solution.py --prefix contoso --publisher Contoso --option-prefix 12345

Import the zip into a development environment (Power Apps > Solutions > Import, or `pac solution import`). The page then
opens at https://<org>.crm.dynamics.com/WebResources/<prefix>_/dme/DataModelExplorer.html, signed in as you.
The publisher unique name must be EXACTLY the one already in the environment, or Dataverse creates a second publisher.
The layout is the one `pac solution pack` writes (checked in tests/webresource.js).
"""
import argparse, pathlib, re, uuid, zipfile
from xml.sax.saxutils import escape, quoteattr

root = pathlib.Path(__file__).resolve().parent.parent
ap = argparse.ArgumentParser()
ap.add_argument('--html', default=str(root / 'dist/Data_Model_Explorer.html'))
ap.add_argument('--out', default=None, help='zip to write (default: dist/<SolutionName>_<version>.zip)')
ap.add_argument('--prefix', default='formus', help='publisher customization prefix, e.g. formus')
ap.add_argument('--publisher', default='FORMUS', help='publisher unique name, exactly as in the environment')
ap.add_argument('--publisher-display', default=None)
ap.add_argument('--option-prefix', default='75047', help="the publisher's choice value prefix (10000-99999)")
ap.add_argument('--solution', default='FORMUS_DataModelExplorer', help='solution unique name')
ap.add_argument('--solution-display', default='Data Model Explorer')
ap.add_argument('--version', default=None, help='four-part version (default: from package.json)')
a = ap.parse_args()

assert re.fullmatch(r'[a-z][a-z0-9]{1,7}', a.prefix) and a.prefix != 'mscrm', 'prefix: 2-8 lower-case letters/digits, starting with a letter'
assert re.fullmatch(r'[A-Za-z_][A-Za-z0-9_]*', a.publisher), 'publisher unique name: letters, digits and _'
assert re.fullmatch(r'[A-Za-z_][A-Za-z0-9_]*', a.solution), 'solution unique name: letters, digits and _'
assert a.option_prefix.isdigit() and 10000 <= int(a.option_prefix) <= 99999, 'option prefix: 10000-99999'
html = pathlib.Path(a.html).read_bytes()
assert b'const DME_MODE = "edit"' in html, 'build the normal page first (npm run build); a read-only copy or a --workbook build is not for this'
if a.version is None:
    import json
    v = json.loads((root / 'package.json').read_text())['version']
    a.version = '.'.join((v.split('-')[0].split('.') + ['0', '0', '0'])[:4])
assert re.fullmatch(r'\d+\.\d+\.\d+\.\d+', a.version), 'version: four numbers'

name = f'{a.prefix}_/dme/DataModelExplorer.html'
wr_id = uuid.uuid5(uuid.NAMESPACE_URL, 'dme-webresource:' + name)   # the same id on every build, so imports update it
pub_disp = a.publisher_display or a.publisher
BOM = '﻿'

customizations = BOM + f'''<?xml version="1.0" encoding="utf-8"?>
<ImportExportXml xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <Entities />
  <Roles />
  <Workflows />
  <FieldSecurityProfiles />
  <Templates />
  <EntityMaps />
  <EntityRelationships />
  <OrganizationSettings />
  <optionsets />
  <CustomControls />
  <SolutionPluginAssemblies />
  <EntityDataProviders />
  <WebResources>
    <WebResource>
      <WebResourceId>{{{wr_id}}}</WebResourceId>
      <Name>{escape(name)}</Name>
      <DisplayName>Data Model Explorer</DisplayName>
      <WebResourceType>1</WebResourceType>
      <IntroducedVersion>1.0.0.0</IntroducedVersion>
      <IsEnabledForMobileClient>0</IsEnabledForMobileClient>
      <IsAvailableForMobileOffline>0</IsAvailableForMobileOffline>
      <IsCustomizable>1</IsCustomizable>
      <CanBeDeleted>1</CanBeDeleted>
      <IsHidden>0</IsHidden>
      <FileName>/WebResources/{escape(name)}</FileName>
    </WebResource>
  </WebResources>
  <Languages>
    <Language>1033</Language>
  </Languages>
</ImportExportXml>'''

nil = lambda t: f'<{t} xsi:nil="true"></{t}>'
address = lambda n, typ: '\n'.join(['        <Address>', f'          <AddressNumber>{n}</AddressNumber>', f'          <AddressTypeCode>{typ}</AddressTypeCode>'] +
    ['          ' + nil(t) for t in ['City', 'County', 'Country', 'Fax', 'FreightTermsCode', 'ImportSequenceNumber', 'Latitude', 'Line1', 'Line2', 'Line3', 'Longitude', 'Name', 'PostalCode', 'PostOfficeBox', 'PrimaryContactName']] +
    ['          <ShippingMethodCode>1</ShippingMethodCode>'] +
    ['          ' + nil(t) for t in ['StateOrProvince', 'Telephone1', 'Telephone2', 'Telephone3', 'TimeZoneRuleVersionNumber', 'UPSZone', 'UTCOffset', 'UTCConversionTimeZoneCode']] + ['        </Address>'])
solution = BOM + f'''<?xml version="1.0" encoding="utf-8"?>
<ImportExportXml version="9.1.0.643" SolutionPackageVersion="9.1" languagecode="1033" generatedBy="CrmLive" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <SolutionManifest>
    <UniqueName>{a.solution}</UniqueName>
    <LocalizedNames>
      <LocalizedName description={quoteattr(a.solution_display)} languagecode="1033" />
    </LocalizedNames>
    <Descriptions />
    <Version>{a.version}</Version>
    <Managed>0</Managed>
    <Publisher>
      <UniqueName>{a.publisher}</UniqueName>
      <LocalizedNames>
        <LocalizedName description={quoteattr(pub_disp)} languagecode="1033" />
      </LocalizedNames>
      <Descriptions>
        <Description description={quoteattr(pub_disp)} languagecode="1033" />
      </Descriptions>
      <EMailAddress xsi:nil="true"></EMailAddress>
      <SupportingWebsiteUrl xsi:nil="true"></SupportingWebsiteUrl>
      <CustomizationPrefix>{a.prefix}</CustomizationPrefix>
      <CustomizationOptionValuePrefix>{a.option_prefix}</CustomizationOptionValuePrefix>
      <Addresses>
{address(1, 1)}
{address(2, 1)}
      </Addresses>
    </Publisher>
    <RootComponents>
      <RootComponent type="61" schemaName="{escape(name)}" behavior="0" />
    </RootComponents>
    <MissingDependencies />
  </SolutionManifest>
</ImportExportXml>'''

content_types = BOM + '<?xml version="1.0" encoding="utf-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/octet-stream" /><Default Extension="html" ContentType="application/octet-stream" /></Types>'

out = pathlib.Path(a.out or root / 'dist' / f'{a.solution}_{a.version.replace(".", "_")}.zip')
out.parent.mkdir(parents=True, exist_ok=True)
with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED) as z:
    z.writestr('customizations.xml', customizations.encode('utf-8'))
    z.writestr('solution.xml', solution.encode('utf-8'))
    z.writestr('WebResources/' + name, html)
    z.writestr('[Content_Types].xml', content_types.encode('utf-8'))
print(f'{out}  ({out.stat().st_size / 1e6:.2f} MB)  web resource {name}, version {a.version}')
print(f'Open after import: https://<your-org>.crm.dynamics.com/WebResources/{name}')
