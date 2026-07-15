// add_test_job.js
// Script to insert a test message into the Campaign Queue to verify the autopilot worker
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const testTargetPhone = "201037850475"; // Replace with a real test number if desired
const testMessage = "يا صاحبي، ده رسالة تجربة من الطيار الآلي للتأكد من أن كل شيء شغال تمام! {ألف|أجمل} تحية ليك.";

async function run() {
  try {
    console.log("Inserting test job into CampaignQueue...");
    const job = await prisma.campaignQueue.create({
      data: {
        targetPhone: testTargetPhone,
        messageBody: testMessage,
        status: "PENDING",
      }
    });
    console.log("Successfully inserted job!");
    console.log("Job Details:", {
      id: job.id,
      target: job.targetPhone,
      message: job.messageBody,
      status: job.status
    });
    console.log("\nNow you can run the PowerShell worker script to process this job:");
    console.log("  .\\_run_worker.ps1");
  } catch (err) {
    console.error("Error inserting test job:", err);
  } finally {
    await prisma.$disconnect();
  }
}

run();
