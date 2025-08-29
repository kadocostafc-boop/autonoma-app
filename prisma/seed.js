const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Iniciando seed do banco...');

  // Profissionais fictícios
  const profissionais = [
    {
      nome: 'João Silva',
      servico: 'Bombeiro Hidráulico',
      cidade: 'Rio de Janeiro',
      bairro: 'Copacabana',
      whatsapp: '21999999999',
      foto: '/uploads/joao.jpg',
      avaliacoes: {
        create: [
          { nome: 'Maria', nota: 5, comentario: 'Excelente atendimento!' },
          { nome: 'Carlos', nota: 4, comentario: 'Resolveu rápido.' }
        ]
      }
    },
    {
      nome: 'Ana Souza',
      servico: 'Cabeleireira',
      cidade: 'São Paulo',
      bairro: 'Moema',
      whatsapp: '11988888888',
      foto: '/uploads/ana.jpg',
      avaliacoes: {
        create: [
          { nome: 'Julia', nota: 5, comentario: 'Corte perfeito!' },
          { nome: 'Paula', nota: 5, comentario: 'Super simpática.' }
        ]
      }
    },
    {
      nome: 'Carlos Oliveira',
      servico: 'Eletricista',
      cidade: 'Belo Horizonte',
      bairro: 'Savassi',
      whatsapp: '31977777777',
      foto: '/uploads/carlos.jpg',
      avaliacoes: {
        create: [
          { nome: 'Roberto', nota: 3, comentario: 'Demorou um pouco, mas resolveu.' },
          { nome: 'Fernanda', nota: 4, comentario: 'Bom profissional.' }
        ]
      }
    }
  ];

  for (const profissional of profissionais) {
    await prisma.profissional.create({ data: profissional });
  }

  console.log('✅ Seed concluído com sucesso.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
