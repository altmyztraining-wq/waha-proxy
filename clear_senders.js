const { PrismaClient } = require('./node_modules/@prisma/client');
const p = new PrismaClient();

async function main() {
  // Delete message logs for banned number first (foreign key)
  const logs = await p.messageLog.deleteMany({
    where: { OR: [{ senderPhone: '201221772093' }, { targetPhone: '201221772093' }] }
  });
  console.log('Message logs deleted for banned number:', logs.count);

  // Delete the banned sender
  const sender = await p.wahaSender.delete({
    where: { phoneNumber: '201221772093' }
  });
  console.log('Deleted banned sender:', sender.phoneNumber);

  // Verify remaining senders
  const remaining = await p.wahaSender.findMany();
  console.log('\nRemaining senders:');
  remaining.forEach(s => console.log(`  ${s.phoneNumber} - ${s.status} - sent: ${s.dailySentCount}/${s.maxDailyLimit}`));

  await p.$disconnect();
}

main().catch(e => { console.error(e); p.$disconnect(); });
