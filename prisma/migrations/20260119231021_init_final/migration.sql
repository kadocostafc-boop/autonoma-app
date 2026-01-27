/*
  Warnings:

  - The primary key for the `Avaliacao` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - You are about to drop the column `clienteNome` on the `Avaliacao` table. All the data in the column will be lost.
  - You are about to drop the column `criadoEm` on the `Avaliacao` table. All the data in the column will be lost.
  - The primary key for the `Profissional` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - You are about to drop the column `chamadas` on the `Profissional` table. All the data in the column will be lost.
  - You are about to drop the column `criadoEm` on the `Profissional` table. All the data in the column will be lost.
  - You are about to drop the column `descricao` on the `Profissional` table. All the data in the column will be lost.
  - You are about to drop the column `fotoUrl` on the `Profissional` table. All the data in the column will be lost.
  - You are about to drop the column `idade` on the `Profissional` table. All the data in the column will be lost.
  - You are about to drop the column `mediaNota` on the `Profissional` table. All the data in the column will be lost.
  - You are about to drop the column `tempoExperiencia` on the `Profissional` table. All the data in the column will be lost.
  - You are about to drop the column `usuarioId` on the `Profissional` table. All the data in the column will be lost.
  - You are about to drop the column `visitas` on the `Profissional` table. All the data in the column will be lost.
  - You are about to drop the column `whatsappPublico` on the `Profissional` table. All the data in the column will be lost.
  - The primary key for the `Servico` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - You are about to drop the column `categoriaId` on the `Servico` table. All the data in the column will be lost.
  - You are about to drop the column `criadoEm` on the `Servico` table. All the data in the column will be lost.
  - You are about to drop the column `descricao` on the `Servico` table. All the data in the column will be lost.
  - You are about to drop the column `preco` on the `Servico` table. All the data in the column will be lost.
  - You are about to drop the column `profissionalId` on the `Servico` table. All the data in the column will be lost.
  - You are about to drop the column `publicado` on the `Servico` table. All the data in the column will be lost.
  - You are about to drop the column `titulo` on the `Servico` table. All the data in the column will be lost.
  - You are about to drop the `Assinatura` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `Categoria` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `Endereco` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `Mensagem` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `Usuario` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `reset_tokens` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `session` table. If the table is not empty, all the data it contains will be lost.
  - A unique constraint covering the columns `[email]` on the table `Profissional` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[whatsapp]` on the table `Profissional` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[nome]` on the table `Servico` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[slug]` on the table `Servico` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `cidade` to the `Profissional` table without a default value. This is not possible if the table is not empty.
  - Added the required column `email` to the `Profissional` table without a default value. This is not possible if the table is not empty.
  - Added the required column `estado` to the `Profissional` table without a default value. This is not possible if the table is not empty.
  - Added the required column `senha` to the `Profissional` table without a default value. This is not possible if the table is not empty.
  - Added the required column `updatedAt` to the `Profissional` table without a default value. This is not possible if the table is not empty.
  - Added the required column `whatsapp` to the `Profissional` table without a default value. This is not possible if the table is not empty.
  - Added the required column `nome` to the `Servico` table without a default value. This is not possible if the table is not empty.
  - Added the required column `slug` to the `Servico` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "Plano" AS ENUM ('FREE', 'PRO', 'PREMIUM');

-- CreateEnum
CREATE TYPE "StatusAssinatura" AS ENUM ('PENDENTE', 'ATIVA', 'CANCELADA');

-- CreateEnum
CREATE TYPE "StatusVerificacao" AS ENUM ('PENDENTE', 'APROVADO', 'REJEITADO');

-- DropForeignKey
ALTER TABLE "public"."Avaliacao" DROP CONSTRAINT "Avaliacao_profissionalId_fkey";

-- DropForeignKey
ALTER TABLE "public"."Endereco" DROP CONSTRAINT "Endereco_profissionalId_fkey";

-- DropForeignKey
ALTER TABLE "public"."Mensagem" DROP CONSTRAINT "Mensagem_profissionalId_fkey";

-- DropForeignKey
ALTER TABLE "public"."Profissional" DROP CONSTRAINT "Profissional_usuarioId_fkey";

-- DropForeignKey
ALTER TABLE "public"."Servico" DROP CONSTRAINT "Servico_categoriaId_fkey";

-- DropForeignKey
ALTER TABLE "public"."Servico" DROP CONSTRAINT "Servico_profissionalId_fkey";

-- DropIndex
DROP INDEX "public"."Avaliacao_profissionalId_idx";

-- DropIndex
DROP INDEX "public"."Profissional_usuarioId_key";

-- DropIndex
DROP INDEX "public"."Profissional_whatsappPublico_key";

-- DropIndex
DROP INDEX "public"."Servico_categoriaId_idx";

-- DropIndex
DROP INDEX "public"."Servico_profissionalId_idx";

-- AlterTable
ALTER TABLE "Avaliacao" DROP CONSTRAINT "Avaliacao_pkey",
DROP COLUMN "clienteNome",
DROP COLUMN "criadoEm",
ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "id" SET DATA TYPE TEXT,
ALTER COLUMN "profissionalId" SET DATA TYPE TEXT,
ADD CONSTRAINT "Avaliacao_pkey" PRIMARY KEY ("id");
DROP SEQUENCE "Avaliacao_id_seq";

-- AlterTable
ALTER TABLE "Profissional" DROP CONSTRAINT "Profissional_pkey",
DROP COLUMN "chamadas",
DROP COLUMN "criadoEm",
DROP COLUMN "descricao",
DROP COLUMN "fotoUrl",
DROP COLUMN "idade",
DROP COLUMN "mediaNota",
DROP COLUMN "tempoExperiencia",
DROP COLUMN "usuarioId",
DROP COLUMN "visitas",
DROP COLUMN "whatsappPublico",
ADD COLUMN     "asaasCustomerId" TEXT,
ADD COLUMN     "asaasSubscriptionId" TEXT,
ADD COLUMN     "ativo" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "bairro" TEXT,
ADD COLUMN     "bio" TEXT,
ADD COLUMN     "cidade" TEXT NOT NULL,
ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "documentoVerificacao" TEXT,
ADD COLUMN     "email" TEXT NOT NULL,
ADD COLUMN     "estado" TEXT NOT NULL,
ADD COLUMN     "foto" TEXT,
ADD COLUMN     "latitude" DOUBLE PRECISION,
ADD COLUMN     "longitude" DOUBLE PRECISION,
ADD COLUMN     "modoRaioAtivo" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "plano" "Plano" NOT NULL DEFAULT 'FREE',
ADD COLUMN     "planoSolicitado" "Plano",
ADD COLUMN     "resetToken" TEXT,
ADD COLUMN     "resetTokenExpires" TIMESTAMP(3),
ADD COLUMN     "senha" TEXT NOT NULL,
ADD COLUMN     "statusAssinatura" "StatusAssinatura" NOT NULL DEFAULT 'PENDENTE',
ADD COLUMN     "statusVerificacao" "StatusVerificacao" NOT NULL DEFAULT 'PENDENTE',
ADD COLUMN     "taxaPlataforma" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL,
ADD COLUMN     "whatsapp" TEXT NOT NULL,
ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "id" SET DATA TYPE TEXT,
ADD CONSTRAINT "Profissional_pkey" PRIMARY KEY ("id");
DROP SEQUENCE "Profissional_id_seq";

-- AlterTable
ALTER TABLE "Servico" DROP CONSTRAINT "Servico_pkey",
DROP COLUMN "categoriaId",
DROP COLUMN "criadoEm",
DROP COLUMN "descricao",
DROP COLUMN "preco",
DROP COLUMN "profissionalId",
DROP COLUMN "publicado",
DROP COLUMN "titulo",
ADD COLUMN     "ativo" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "nome" TEXT NOT NULL,
ADD COLUMN     "slug" TEXT NOT NULL,
ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "id" SET DATA TYPE TEXT,
ADD CONSTRAINT "Servico_pkey" PRIMARY KEY ("id");
DROP SEQUENCE "Servico_id_seq";

-- DropTable
DROP TABLE "public"."Assinatura";

-- DropTable
DROP TABLE "public"."Categoria";

-- DropTable
DROP TABLE "public"."Endereco";

-- DropTable
DROP TABLE "public"."Mensagem";

-- DropTable
DROP TABLE "public"."Usuario";

-- DropTable
DROP TABLE "public"."reset_tokens";

-- DropTable
DROP TABLE "public"."session";

-- CreateTable
CREATE TABLE "ProfissionalServico" (
    "id" TEXT NOT NULL,
    "profissionalId" TEXT NOT NULL,
    "servicoId" TEXT NOT NULL,

    CONSTRAINT "ProfissionalServico_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Denuncia" (
    "id" TEXT NOT NULL,
    "profissionalId" TEXT NOT NULL,
    "motivo" TEXT NOT NULL,
    "cidade" TEXT,
    "estado" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Denuncia_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Pagamento" (
    "id" TEXT NOT NULL,
    "profissionalId" TEXT NOT NULL,
    "valor" DOUBLE PRECISION NOT NULL,
    "taxaPlataforma" DOUBLE PRECISION NOT NULL,
    "plano" "Plano" NOT NULL,
    "asaasPaymentId" TEXT,
    "status" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Pagamento_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProfissionalServico_profissionalId_servicoId_key" ON "ProfissionalServico"("profissionalId", "servicoId");

-- CreateIndex
CREATE UNIQUE INDEX "Profissional_email_key" ON "Profissional"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Profissional_whatsapp_key" ON "Profissional"("whatsapp");

-- CreateIndex
CREATE UNIQUE INDEX "Servico_nome_key" ON "Servico"("nome");

-- CreateIndex
CREATE UNIQUE INDEX "Servico_slug_key" ON "Servico"("slug");

-- AddForeignKey
ALTER TABLE "ProfissionalServico" ADD CONSTRAINT "ProfissionalServico_profissionalId_fkey" FOREIGN KEY ("profissionalId") REFERENCES "Profissional"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProfissionalServico" ADD CONSTRAINT "ProfissionalServico_servicoId_fkey" FOREIGN KEY ("servicoId") REFERENCES "Servico"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Avaliacao" ADD CONSTRAINT "Avaliacao_profissionalId_fkey" FOREIGN KEY ("profissionalId") REFERENCES "Profissional"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Denuncia" ADD CONSTRAINT "Denuncia_profissionalId_fkey" FOREIGN KEY ("profissionalId") REFERENCES "Profissional"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Pagamento" ADD CONSTRAINT "Pagamento_profissionalId_fkey" FOREIGN KEY ("profissionalId") REFERENCES "Profissional"("id") ON DELETE CASCADE ON UPDATE CASCADE;
