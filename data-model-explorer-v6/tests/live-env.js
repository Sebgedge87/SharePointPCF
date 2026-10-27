// A stand-in Dataverse environment for tests and screenshots, built from the import test workbook, with differences
// added. Used by tests/live.js and tools/live-screenshots.js.
const path = require('path'), XLSX = require('xlsx'), crypto = require('crypto');
const wbk = path.join(__dirname, '../samples/Import_Test_Model.xlsx');
const guid = s => { const h = crypto.createHash('md5').update(s).digest('hex'); return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`; };
const L = t => ({ UserLocalizedLabel: { Label: t } });
// ---- a stand-in Dataverse, built from the workbook ----
function environment(managed) {
  const wb = XLSX.readFile(wbk), ents = {};
  const TYPES = { 'text': ['String', 'StringType'], 'multiline text': ['Memo', 'MemoType'], 'currency': ['Money', 'MoneyType'], 'datetime': ['DateTime', 'DateTimeType'], 'choice': ['Picklist', 'PicklistType'],
    'choices': ['Virtual', 'MultiSelectPicklistType'], 'lookup': ['Lookup', 'LookupType'], 'uniqueidentifier': ['Uniqueidentifier', 'UniqueidentifierType'], 'decimal': ['Decimal', 'DecimalType'],
    'whole number': ['Integer', 'IntegerType'], 'two options': ['Boolean', 'BooleanType'] };
  const addl = s => { const o = { opts: [], targets: [] }; let sec = ''; String(s || '').split('\n').forEach(l => { l = l.trim(); const m = /^([^:]+):\s*(.*)$/.exec(l); if (m && !/^\d+$/.test(m[1])) { sec = m[1].toLowerCase(); if (m[2] !== '') o[sec] = m[2]; } else if (sec === 'options') { const k = /^(\d+):\s*(.*)$/.exec(l); if (k) o.opts.push({ Value: +k[1], Label: L(k[2]) }); } else if (sec === 'targets' && l) o.targets.push(l); }); return o; };
  wb.SheetNames.filter(n => n !== 'Table Dictionary').forEach(n => {
    const m = XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, defval: '' }), det = Object.fromEntries(m.filter(r => r[0] && r[1] !== '' && !String(r[0]).includes(' Name') || ['Logical Name', 'Schema Name'].includes(r[0])).slice(0, 14).map(r => [r[0], r[1]]));
    const ln = String(m.find(r => r[0] === 'Logical Name')[1]).toLowerCase(), hi = m.findIndex(r => r[0] === 'Logical Name' && r[1] === 'Schema Name');
    const e = ents[ln] = { MetadataId: guid('e:' + ln), LogicalName: ln, SchemaName: m.find(r => r[0] === 'Schema Name')[1], DisplayName: L(m[0][1]), DisplayCollectionName: L(m[1][1]), Description: L(m[2][1]),
      ObjectTypeCode: 10000 + Object.keys(ents).length, IsCustomEntity: true, IsManaged: managed, OwnershipType: 'UserOwned', IsAuditEnabled: { Value: true }, PrimaryIdAttribute: ln + 'id', PrimaryNameAttribute: 'formus_name',
      IsActivity: false, HasNotes: true, HasActivities: false, Attributes: [], ManyToOneRelationships: [], OneToManyRelationships: [], ManyToManyRelationships: [], Keys: [], _d: {} };
    void det;
    m.slice(hi + 1).forEach(r => {
      if (!r[0] || r[0] === 'Forms:' || r[0] === 'Views:') return; const a = String(r[0]).toLowerCase(), A = addl(r[8]);
      if (r[11] === 'N:N') { e._nn = (e._nn || []).concat([{ name: a, other: A.targets[0] }]); return; }
      const [t, tn] = TYPES[String(r[3]).toLowerCase()] || ['String', 'StringType'];
      e.Attributes.push({ MetadataId: guid('a:' + ln + '.' + a), LogicalName: a, SchemaName: r[1], DisplayName: L(r[2]), Description: L(r[4]), AttributeType: t, AttributeTypeName: { Value: tn }, IsCustomAttribute: true, IsManaged: managed,
        RequiredLevel: { Value: r[7] || 'None' }, AttributeOf: null, SourceType: 0 });
      const d = e._d[a] = { LogicalName: a, _cls: tn };
      if (tn === 'StringType') Object.assign(d, { MaxLength: +(A['max length'] || 100), FormatName: { Value: A.format || 'Text' } });
      if (tn === 'MemoType') d.MaxLength = +(A['max length'] || 2000);
      if (/Money|Decimal/.test(tn)) Object.assign(d, { MinValue: +(A['minimum value'] || 0), MaxValue: +(A['maximum value'] || 1000), Precision: +(A.precision || 2) });
      if (tn === 'IntegerType') Object.assign(d, { MinValue: +(A['minimum value'] || 0), MaxValue: +(A['maximum value'] || 100) });
      if (tn === 'DateTimeType') d.Format = A.format || 'DateAndTime';
      if (tn === 'BooleanType') Object.assign(d, { DefaultValue: false, OptionSet: { TrueOption: { Value: 1, Label: L(A.true || 'Yes') }, FalseOption: { Value: 0, Label: L(A.false || 'No') } } });
      if (/Picklist/.test(tn)) Object.assign(d, { DefaultFormValue: A.default ? +A.default : -1, OptionSet: { Options: A.opts } });
      if (tn === 'LookupType') { d.Targets = A.targets; e.ManyToOneRelationships.push({ SchemaName: 'formus_' + A.targets[0] + '_' + ln + '_' + a, ReferencedEntity: A.targets[0], ReferencingEntity: ln, ReferencingAttribute: a, CascadeConfiguration: { Delete: ({ restrict: 'Restrict', cascade: 'Cascade' })[String(r[13]).toLowerCase()] || 'RemoveLink' }, IsCustomRelationship: true, IsManaged: managed }); }
    });
    // standard columns every table has, and a helper column that belongs to another one
    e.Attributes.push({ MetadataId: guid('a:' + ln + '.createdon'), LogicalName: 'createdon', SchemaName: 'CreatedOn', DisplayName: L('Created On'), AttributeType: 'DateTime', AttributeTypeName: { Value: 'DateTimeType' }, IsCustomAttribute: false, IsManaged: true, RequiredLevel: { Value: 'None' }, AttributeOf: null, SourceType: 0 });
    e._d.createdon = { LogicalName: 'createdon', _cls: 'DateTimeType', Format: 'DateAndTime' };
    e.Attributes.filter(a => a.AttributeType === 'Lookup').forEach(a => e.Attributes.push({ LogicalName: a.LogicalName + 'name', AttributeType: 'String', AttributeTypeName: { Value: 'StringType' }, AttributeOf: a.LogicalName, IsCustomAttribute: true, RequiredLevel: { Value: 'None' } }));
  });
  Object.values(ents).forEach(e => (e._nn || []).forEach(r => { const rel = { SchemaName: r.name, Entity1LogicalName: e.LogicalName, Entity2LogicalName: r.other, IntersectEntityName: r.name, IsCustomRelationship: true, IsManaged: managed }; e.ManyToManyRelationships.push(rel); if (ents[r.other]) ents[r.other].ManyToManyRelationships.push(rel); }));
  // the differences from the workbook
  const task = ents.formus_testtask;
  task.Attributes = task.Attributes.filter(a => a.LogicalName !== 'formus_complete');                                       // designed, not built
  task.Attributes.find(a => a.LogicalName === 'formus_duedate').RequiredLevel = { Value: 'ApplicationRequired' };          // built differently
  task.Attributes.push({ MetadataId: guid('a:extracode'), LogicalName: 'formus_extracode', SchemaName: 'formus_ExtraCode', DisplayName: L('Extra code'), AttributeType: 'String', AttributeTypeName: { Value: 'StringType' }, IsCustomAttribute: true, IsManaged: false, RequiredLevel: { Value: 'None' }, AttributeOf: null, SourceType: 0 });
  task._d.formus_extracode = { LogicalName: 'formus_extracode', _cls: 'StringType', MaxLength: 20, FormatName: { Value: 'Text' } }; // added in the environment, not documented
  ents.formus_testextra = { MetadataId: guid('e:formus_testextra'), LogicalName: 'formus_testextra', SchemaName: 'formus_TestExtra', DisplayName: L('Test Extra'), DisplayCollectionName: L('Test Extras'), Description: L(''), ObjectTypeCode: 10099,
    IsCustomEntity: true, IsManaged: managed, OwnershipType: 'UserOwned', IsAuditEnabled: { Value: false }, PrimaryIdAttribute: 'formus_testextraid', PrimaryNameAttribute: 'formus_name', IsActivity: false, HasNotes: false, HasActivities: false,
    Attributes: [{ MetadataId: guid('a:x.id'), LogicalName: 'formus_testextraid', SchemaName: 'formus_TestExtraId', DisplayName: L('Test Extra'), AttributeType: 'Uniqueidentifier', AttributeTypeName: { Value: 'UniqueidentifierType' }, IsCustomAttribute: true, IsManaged: managed, RequiredLevel: { Value: 'SystemRequired' }, AttributeOf: null, SourceType: 0 },
      { MetadataId: guid('a:x.name'), LogicalName: 'formus_name', SchemaName: 'formus_Name', DisplayName: L('Name'), AttributeType: 'String', AttributeTypeName: { Value: 'StringType' }, IsCustomAttribute: true, IsManaged: managed, RequiredLevel: { Value: 'ApplicationRequired' }, AttributeOf: null, SourceType: 0 }],
    ManyToOneRelationships: [], OneToManyRelationships: [], ManyToManyRelationships: [], Keys: [], _d: { formus_name: { LogicalName: 'formus_name', _cls: 'StringType', MaxLength: 100, FormatName: { Value: 'Text' } } } };   // a table in the solution, not documented
  // contact: a standard table in the solution as a shell, bringing one custom column
  ents.contact = { MetadataId: guid('e:contact'), LogicalName: 'contact', SchemaName: 'Contact', DisplayName: L('Contact'), DisplayCollectionName: L('Contacts'), Description: L('Person'), ObjectTypeCode: 2, IsCustomEntity: false, IsManaged: true,
    OwnershipType: 'UserOwned', IsAuditEnabled: { Value: true }, PrimaryIdAttribute: 'contactid', PrimaryNameAttribute: 'fullname', IsActivity: false, HasNotes: true, HasActivities: true,
    Attributes: [['contactid', 'Uniqueidentifier', 'UniqueidentifierType', false], ['fullname', 'String', 'StringType', false], ['emailaddress1', 'String', 'StringType', false], ['formus_projectid', 'Lookup', 'LookupType', true]].map(([a, t, tn, c]) => ({ MetadataId: guid('a:contact.' + a), LogicalName: a, SchemaName: a, DisplayName: L(a), AttributeType: t, AttributeTypeName: { Value: tn }, IsCustomAttribute: c, IsManaged: true, RequiredLevel: { Value: 'None' }, AttributeOf: null, SourceType: 0 })),
    ManyToOneRelationships: [{ SchemaName: 'formus_testproject_contact_projectid', ReferencedEntity: 'formus_testproject', ReferencingEntity: 'contact', ReferencingAttribute: 'formus_projectid', CascadeConfiguration: { Delete: 'RemoveLink' }, IsCustomRelationship: true, IsManaged: true }],
    OneToManyRelationships: [], ManyToManyRelationships: [], Keys: [], _d: { formus_projectid: { LogicalName: 'formus_projectid', _cls: 'LookupType', Targets: ['formus_testproject'] } } };
  const sol = { solutionid: guid('s:import'), uniquename: 'FORMUS_ImportTest', friendlyname: 'FORMUS import test', version: '1.0.0.0', ismanaged: managed };
  const comps = ['formus_testproject', 'formus_testtask', 'formus_testresource', 'formus_testextra'].map(t => ({ objectid: ents[t].MetadataId, componenttype: 1, rootcomponentbehavior: 0 }))
    .concat([{ objectid: ents.contact.MetadataId, componenttype: 1, rootcomponentbehavior: 2 }, { objectid: guid('a:contact.formus_projectid'), componenttype: 2, rootcomponentbehavior: null }]);
  // an unmanaged layer on a managed column: someone renamed "Name" on Test Project in this environment
  const layers = managed ? { [guid('a:formus_testproject.formus_name')]: [{ msdyn_solutionname: 'Active', msdyn_order: 2, msdyn_changes: JSON.stringify({ Attributes: [{ Key: 'displayname', Value: 'Project name' }, { Key: 'modifiedon', Value: 'x' }] }) }, { msdyn_solutionname: 'FORMUS_ImportTest', msdyn_order: 1 }] } : {};
  return { ents, sol, comps, layers, calls: [] };
}
function answer(env, url) {
  const u = new URL(url), p = decodeURIComponent(u.pathname.replace('/api/data/v9.2/', '')), q = decodeURIComponent(u.search); env.calls.push(p + q);
  const json = (body, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });
  const strip = e => { const { _d, _nn, ...rest } = e; void _d; void _nn; return rest; };
  if (p === 'WhoAmI') return json({ UserId: guid('u') });
  if (p.startsWith('systemusers(')) return json({ fullname: 'Test Consultant' });
  if (p === 'solutions') return json({ value: [env.sol, { solutionid: guid('s:def'), uniquename: 'Default', friendlyname: 'Default Solution', version: '1.0', ismanaged: false },
    { solutionid: guid('s:sales'), uniquename: 'contoso_Sales', friendlyname: 'Contoso sales', version: '2.1.0.0', ismanaged: false },
    { solutionid: guid('s:portal'), uniquename: 'msdynce_PortalIdentity', friendlyname: 'Dynamics 365 Portals - Identity', version: '9.3.2409.1', ismanaged: true },
    { solutionid: guid('s:fs'), uniquename: 'msdyn_FieldService', friendlyname: 'Field Service', version: '8.8.1.0', ismanaged: true }] });
  if (p === 'solutioncomponents') return json({ value: q.includes(env.sol.solutionid) ? env.comps : [] });
  if (p === 'msdyn_componentlayers') { const id = /msdyn_componentid eq '([^']+)'/.exec(q)[1]; return json({ value: env.layers[id] || [] }); }
  let m = /^EntityDefinitions\(([0-9a-f-]{36})\)$/.exec(p);
  if (m) { const e = Object.values(env.ents).find(x => x.MetadataId === m[1]); return e ? json({ LogicalName: e.LogicalName }) : json({ error: { message: 'not found' } }, 404); }
  m = /^EntityDefinitions\(LogicalName='([a-z0-9_]+)'\)(?:\/Attributes\/Microsoft\.Dynamics\.CRM\.(\w+)AttributeMetadata)?$/.exec(p);
  if (m) { const e = env.ents[m[1]]; if (!e) return json({ error: { code: '0x80060888', message: 'Could not find an entity with name ' + m[1] } }, 404);
    if (!m[2]) return json(strip(e));
    const cls = { String: 'StringType', Memo: 'MemoType', Integer: 'IntegerType', Decimal: 'DecimalType', Double: 'DoubleType', Money: 'MoneyType', DateTime: 'DateTimeType', Boolean: 'BooleanType', Picklist: 'PicklistType', MultiSelectPicklist: 'MultiSelectPicklistType', Lookup: 'LookupType' }[m[2]];
    return json({ value: Object.values(e._d).filter(d => d._cls === cls).map(({ _cls, ...d }) => (void _cls, d)) }); }
  return json({ error: { message: 'unexpected call ' + p } }, 400);
}

module.exports = { environment, answer, guid };
