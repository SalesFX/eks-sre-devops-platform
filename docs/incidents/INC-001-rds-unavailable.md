# INC-001: RDS Unavailable

**Data:** 2026-05-15
**Duracao:** 23 minutos (14:37 a 15:00 UTC)
**Severidade:** SEV1
**Status:** Resolved
**Servicos afetados:** backend (todas as rotas com banco), frontend (telas que dependem de API)

---

## Linha do tempo

| Hora (UTC) | Evento |
|---|---|
| 14:35 | CloudWatch alarm `rds-connections-high` dispara (conexoes: 84) |
| 14:36 | SNS envia email de alerta para `samuelsalesz@hotmail.com` |
| 14:37 | Usuario reporta "Erro 500 ao criar incidente" no Incident Tracker |
| 14:39 | On-call verifica `/backend/health`: retorna `{"status":"ok","db":"error"}` |
| 14:41 | `kubectl logs deploy/backend -n app` mostra `FATAL: PAM authentication failed` |
| 14:43 | Investigacao: token IRSA gerado, mas `app_user` sem `GRANT rds_iam` |
| 14:52 | SQL de correcao executado via pod temporario no cluster |
| 14:58 | `kubectl rollout restart deployment/backend -n app` |
| 15:00 | `/backend/health` retorna `{"status":"ok","db":"connected"}` |
| 15:02 | CloudWatch alarm retorna para OK |

## Sintomas observados

- `/backend/health` retornando `db: "error"` e status HTTP 503
- Todos os endpoints de negocio retornando 500
- ALB health checks passando (a rota `/backend/health` retorna 200 mesmo com `db: error` — BUG identificado)
- Pods em Running (nao havia crash), o que atrasou o diagnostico inicial

## Causa raiz

Durante a criacao manual do `app_user` no PostgreSQL (antes do primeiro deploy), o `GRANT rds_iam TO app_user` foi omitido por erro humano. O banco aceitou conexoes durante a fase inicial porque o `DATABASE_URL` com senha do master ainda estava no Secret. Apos a migracao para IRSA (remocao do `DATABASE_URL` do deployment), as novas conexoes via IAM token comecaram a falhar com `PAM authentication failed`.

O alarme `rds-connections-high` disparou porque as tentativas de reconexao acumularam conexoes pendentes no pool do RDS antes de falharem.

## Resolucao

```sql
-- Executado via kubectl run (pod temporario no cluster)
GRANT rds_iam TO app_user;
```

Seguido de rollout restart do backend para forcar regeneracao do token IAM.

## Analise de impacto

- 23 minutos de indisponibilidade total do servico de backend
- Nenhum dado perdido (banco estava acessivel via master, aplicacao apenas nao conseguia autenticar)
- Detectado via CloudWatch alarm antes de report de usuario (alarme antecipou em 2 minutos)

## Acoes pos-incidente

- [x] Documentar o SQL de setup do `app_user` no README (secao Bootstrap)
- [x] Corrigir o health check: retornar status HTTP 503 quando `db: "error"` (nao apenas no body JSON)
- [ ] Adicionar alerta especifico para `PAM authentication failed` nos logs (requer Loki)
- [ ] Criar checklist de validacao pos-deploy que inclui teste de autenticacao IAM

## Licoes aprendidas

1. O health check retornando HTTP 200 com `db: "error"` mascarou o problema para o ALB — pods continuavam "healthy" do ponto de vista do load balancer mas falhavam para os usuarios
2. Dependencia de etapa manual (`GRANT rds_iam`) e um ponto fragil — automatizar via Terraform ou script de bootstrap
3. O alarm `rds-connections-high` foi o primeiro indicador, mais rapido que o report de usuario
