-- Duas categorias de receita que o enum original não cobria: venda de
-- produto físico e venda de bem pessoal. Precisamos da segunda para nunca
-- deixar um recebimento de venda de ativo pessoal (ex.: moto) classificado
-- junto com categorias de faturamento operacional (DEVELOPMENT/PROJECT/...)
-- — ver CATEGORY_DIRECTION em packages/shared-types/src/finance.ts.
--
-- Aditiva e sem risco: apenas acrescenta valores ao enum, nenhuma tabela
-- muda. `ALTER TYPE ... ADD VALUE` é seguro dentro da transação de migração
-- porque nenhuma linha usa os valores novos nesta mesma migração.

-- AlterEnum
ALTER TYPE "FinancialCategory" ADD VALUE 'PRODUCT_SALE';
ALTER TYPE "FinancialCategory" ADD VALUE 'PERSONAL_ASSET_SALE';
