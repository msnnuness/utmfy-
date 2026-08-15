# utmify-bridge

Lançamento manual de depósitos na Utmify, via API de credenciais.
Uma conta, um depósito por vez, com preview do payload antes de enviar.

## Por que um servidor e não uma página estática

Dois motivos:

1. **CORS.** `api.utmify.com.br` é uma API server-to-server. Uma chamada `fetch`
   direto do browser é bloqueada.
2. **Segredo.** O `x-api-token` fica só em variável de ambiente. Se estivesse no
   front, qualquer pessoa com acesso à URL poderia lançar pedidos na sua conta.

## Deploy no Render

1. Suba a pasta num repositório no GitHub.
2. No Render: **New → Web Service**, aponte para o repo.
   - Build command: `npm install`
   - Start command: `npm start`
3. Em **Environment**, adicione:

   | Variável | Valor |
   |---|---|
   | `UTMIFY_TOKEN` | credencial gerada em Integrações → Webhooks → Credenciais de API |
   | `DEFAULT_PLATFORM` | nome da plataforma em PascalCase, ex.: `MinhaBet` |
   | `DATA_DIR` | `/var/data` (só se você montar disco persistente) |

4. **Disco persistente**: sem ele, presets e histórico somem a cada redeploy.
   Em **Disks**, monte um disco de 1 GB em `/var/data` e defina `DATA_DIR`.
   Isso não afeta os pedidos já enviados — eles vivem na Utmify, não aqui.

5. **Proteja a URL.** O serviço não tem login. Enquanto não tiver, trate o link
   como segredo, ou coloque um Cloudflare Access na frente.

## Como usar

1. Ligue **modo teste** e envie um lançamento. A API valida o payload inteiro e
   devolve erro de campo se algo estiver fora do formato, sem salvar nada.
2. Confirmado o formato, desligue o modo teste e lance de verdade.
3. Confira na aba **Resumo** do dashboard da Utmify.

### Atualizar o status de um pedido

Reenvie com o **mesmo `orderId`** e o **mesmo `createdAt`**, mudando só o
`status` e a data de aprovação. É assim que um `waiting_payment` vira `paid`.

### Limites que a API impõe

- Pedidos com mais de **7 dias** são recusados (45 dias apenas para `refunded` e
  `chargedback`). O app avisa antes de você tentar. Não dá para fazer backfill.
- `userCommissionInCents` não pode ser zero, a menos que você realmente não tenha
  recebido nada.

## Quando a plataforma liberar postback

O objeto no painel direito é exatamente o corpo que o backend precisará montar.
A entrada manual sai, o webhook entra, e o resto do desenho continua igual:
a chave é o `trackingParameters` chegar preenchido.
