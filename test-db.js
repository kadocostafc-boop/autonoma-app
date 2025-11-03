import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function testConnection() {
  try {
    const now = await prisma.$queryRaw`SELECT NOW();`;
    console.log('[TESTE OK] Conexão com Neon ativa:', now);
  } catch (err) {
    console.error('[ERRO] Falha ao conectar com o Neon:', err);
  } finally {
    await prisma.$disconnect();
  }
}

testConnection();
