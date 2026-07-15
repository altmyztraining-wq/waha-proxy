const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
prisma.wahaSender.findMany().then(r => {
  console.log(r);
}).then(() => prisma.$disconnect());
