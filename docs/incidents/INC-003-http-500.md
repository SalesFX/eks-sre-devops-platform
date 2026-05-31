# INC-003: HTTP 500 em criacao de incidentes

**Data:** 2026-05-28
**Duracao:** 31 minutos (18:05 a 18:36 UTC)
**Severidade:** SEV2
**Status:** Resolved
**Servicos afetados:** `POST /backend/incidents` (criacao de novos incidentes)

---

## Linha do tempo

| Hora (UTC) | Evento |
|---|---|
| 18:05 | Usuario reporta "erro ao criar incidente" — botao de submit retorna erro 500 |
| 18:07 | On-call verifica `/backend/health`: retorna `{"status":"ok","db":"connected"}` |
| 18:08 | Teste manual: `POST /backend/incidents` retorna `500 Internal Server Error` |
| 18:09 | Logs do backend: `Invalid value for argument severity: 'SEV5'` (PrismaClientValidationError) |
| 18:11 | Identificada origem: frontend enviando `severity: "SEV5"` em vez de `SEV1-SEV4` |
| 18:14 | Commit do frontend que introduziu o bug identificado: `sha-a15a281` |
| 18:16 | Hotfix no frontend commitado, CI inicia build |
| 18:28 | Nova imagem frontend `sha-f8a91c3` disponivel no ECR; kustomization atualizado |
| 18:32 | ArgoCD sincroniza; novo pod frontend sobe |
| 18:36 | `POST /backend/incidents` com `severity: "SEV3"` retorna 201 com sucesso |

## Sintomas observados

- Endpoint `POST /backend/incidents` retornando 500 para todos os usuarios
- Outros endpoints (`GET /backend/incidents`, `GET /backend/dashboard/summary`) funcionando normalmente
- Health check passando — problema isolado a uma rota especifica

## Causa raiz

Um refactor no formulario de criacao de incidentes no frontend adicionou um campo de "Critico" como opcao de severidade com valor `"SEV5"`. O enum `Severity` do Prisma so aceita `SEV1`, `SEV2`, `SEV3`, `SEV4`. O backend nao tinha validacao explicita da severidade antes de chamar o Prisma — delegava a validacao ao ORM, que lancava `PrismaClientValidationError` retornado como 500 em vez de 400.

O bug foi introducido no frontend sem atualizacao correspondente no schema do Prisma e sem teste de contrato entre frontend e backend.

## Resolucao

**Imediata (frontend):** remover `"SEV5"` do select de severidade.

**Defensiva (backend):** adicionar validacao explicita antes da chamada ao Prisma:

```typescript
const VALID_SEVERITIES = ['SEV1', 'SEV2', 'SEV3', 'SEV4'] as const

if (!VALID_SEVERITIES.includes(body.severity)) {
  return res.status(400).json({
    error: `Invalid severity. Must be one of: ${VALID_SEVERITIES.join(', ')}`
  })
}
```

## Analise de impacto

- 31 minutos sem conseguir criar novos incidentes
- Incidentes existentes e o dashboard nao foram afetados
- Nenhum dado corrompido

## Acoes pos-incidente

- [x] Validacao de enum no backend antes de chamar o Prisma (retorna 400 em vez de 500)
- [x] Adicionar teste de integracao para `POST /backend/incidents` com severity invalida
- [ ] Implementar contract testing entre frontend e backend (ex: Pact) na pipeline
- [ ] Adicionar Semgrep rule para detectar `prisma.*.create` sem validacao previa de enum

## Licoes aprendidas

1. Delegar validacao de dominio ao ORM resulta em erros 500 em vez de 400 — usuarios recebem mensagem de erro generica sem entender o que fizeram errado
2. A ausencia de testes de contrato entre frontend e backend permite que mudancas no frontend quebrem o backend silenciosamente
3. O scope do incidente foi facilmente identificado pelos logs do Prisma — quando Loki estiver disponivel, criar alerta para `PrismaClientValidationError`
