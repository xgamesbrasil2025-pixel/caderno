# Caderno PMBA — pronto para o Railway

Esta versão roda como um único serviço no Railway. O banco SQLite e as imagens dos resumos ficam no mesmo volume persistente, em `/app/data`.

## Como publicar

1. Crie um repositório vazio no GitHub.
2. Extraia o ZIP e envie **todos os arquivos e pastas extraídos** para esse repositório.
3. No Railway, escolha **New Project → Deploy from GitHub Repo** e selecione o repositório.
4. Dentro do serviço criado, abra **Volumes**, adicione um volume e use o caminho de montagem:

```text
/app/data
```

5. Em **Variables**, adicione:

```text
DATA_DIR=/app/data
ADMIN_EMAILS=seu-email@example.com
OPENAI_API_KEY=sua-chave-da-openai
OPENAI_MODEL=gpt-6-luna
OPENAI_MAX_OUTPUT_TOKENS=1200
```

6. Abra **Settings → Networking** e clique em **Generate Domain**.
7. Acesse o domínio, crie uma conta com o mesmo e-mail configurado em `ADMIN_EMAILS` e entre. Essa conta será aprovada automaticamente como administradora.

As tabelas do banco são criadas automaticamente na primeira inicialização. Não é necessário configurar PostgreSQL nem executar migrações manualmente.

## O que já está incluído

- matérias e 107 tópicos do edital;
- login, usuários e administração;
- vários resumos por tópico, com formatação e imagens;
- aprimoramento de revisão pela OpenAI;
- Caderno de Erros e flashcards automáticos;
- repetição espaçada;
- cronograma persistente;
- interface responsiva para computador e celular.

## Importante

- Nunca coloque a chave da OpenAI no GitHub. Configure-a somente em **Variables** no Railway.
- Não remova o volume depois de começar a usar. Ele contém contas, resumos, imagens, cronograma, erros e flashcards.
- Esta cópia começa com o banco de usuários vazio; as matérias e os tópicos já vêm no código.
- A cobrança da IA ocorre na conta da API vinculada à variável `OPENAI_API_KEY`, separadamente da assinatura do ChatGPT.

## Desenvolvimento local opcional

Requer Node.js 22 ou superior e pnpm.

```text
pnpm install
pnpm dev
```

Para validar a versão de produção:

```text
pnpm build
pnpm start
```
