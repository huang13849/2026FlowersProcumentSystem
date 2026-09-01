const router = require('express').Router();
const applications = require('../services/supplierApplications');
const { fromReq } = require('../services/supplierService');
const { publishDecision } = require('../services/supplierApplicationNats');

router.get('/', async (req, res) => {
  try { res.json({ items: await applications.list(req.query.status) }); }
  catch (error) { res.status(500).json({ error: error.message }); }
});

router.post('/:id/decision', async (req, res) => {
  try {
    const decision = String((req.body || {}).decision || '');
    const reviewNote = String((req.body || {}).reviewNote || '').trim().slice(0, 500);
    if (!['approved', 'rejected'].includes(decision)) return res.status(400).json({ error: 'decision_invalid' });
    if (decision === 'rejected' && !reviewNote) return res.status(400).json({ error: 'review_note_required' });
    const application = await applications.get(req.params.id);
    if (!application) return res.status(404).json({ error: 'supplier_application_not_found' });
    if (application.status !== 'pending') return res.status(409).json({ error: 'supplier_application_already_decided' });
    let supplierId = null;
    if (decision === 'approved') {
      const data = application.payload || {};
      const supplier = await fromReq(req).create({
        name: application.company_name, shop_name: application.company_name, status: '待整理',
        contact: { name: data.contactName || '', phone: data.contactPhone || '' },
        contacts: [{ name: data.contactName || '', phone: data.contactPhone || '', title: data.jobTitle || '', gender: '' }],
        company_info: { tax_id: application.credit_code, address: data.companyAddress || '', main_business: data.mainBusiness || '' },
        business_items: [{ main_business: data.mainBusiness || '', address: data.companyAddress || '', planting_area: null, estimated_inventory: null, sales_period: '' }],
        address: data.companyAddress || '', license_files: Array.isArray(data.businessLicenseFiles) ? data.businessLicenseFiles : [],
        notes: `植物联盟银牌会员申请 #${application.external_application_id}`,
      });
      supplierId = supplier && supplier._id;
    }
    const decided = await applications.decide(application.id, decision, reviewNote, supplierId);
    await publishDecision(decided);
    res.json({ ok: true, application: decided });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

module.exports = router;
