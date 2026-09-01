const { connect, JSONCodec } = require('nats');
const applications = require('./supplierApplications');

const jc = JSONCodec();
const NATS_URL = process.env.NATS_URL || 'nats://nats.messaging.svc.cluster.local:4222';
const SUBMITTED_SUBJECT = process.env.SUPPLIER_APPLICATION_SUBMITTED_SUBJECT || 'supplier.applications.submitted';
const REVIEWED_SUBJECT = process.env.SUPPLIER_APPLICATION_REVIEWED_SUBJECT || 'supplier.applications.reviewed';
let connection;

async function startSupplierApplicationConsumer() {
  connection = await connect({ servers: NATS_URL, name: 'supplier-service-applications', timeout: 2000 });
  connection.closed().then(() => { connection = null; });
  const subscription = connection.subscribe(SUBMITTED_SUBJECT);
  (async () => {
    for await (const message of subscription) {
      try {
        const event = jc.decode(message.data);
        if (event && event.type === 'supplier.application.submitted' && event.applicationId) await applications.receive(event);
      } catch (error) { console.warn('[supplier-applications] event skipped:', error.message); }
    }
  })();
  console.log(`[supplier-applications] listening on ${SUBMITTED_SUBJECT}`);
}

async function publishDecision(application) {
  if (!connection) throw new Error('nats_not_connected');
  connection.publish(REVIEWED_SUBJECT, jc.encode({
    type: 'supplier.application.reviewed', sourceProject: application.source_project,
    applicationId: application.external_application_id, status: application.status,
    reviewNote: application.review_note || '', supplierId: application.supplier_id || null,
  }));
  await connection.flush();
}

module.exports = { startSupplierApplicationConsumer, publishDecision };
