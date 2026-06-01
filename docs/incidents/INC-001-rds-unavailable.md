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

---

## Simulacao em producao — 2026-06-01

**Severidade:** Critico — servico completamente fora do ar (503 no ALB)
**MTTR: ~4 minutos**

| Horario (BRT) | Evento |
|---|---|
| 15:32:37 | `REVOKE rds_iam FROM app_user` executado via pod temporario |
| 15:33:20 | Backend reiniciado — novos pods tentam gerar token IAM e falham |
| 15:33:xx | Readiness probe retorna 503 — pods marcados como 0/1 (nao prontos) |
| 15:33:xx | ALB para de rotear trafego — servico completamente fora do ar |
| 15:37:01 | Alertas `PodCrashLooping` (Critico) e `DeploymentReplicasMismatch` disparam |
| 15:37:34 | `GRANT rds_iam TO app_user` restaurado + rollout restart |
| 15:38:11 | Backend reconecta ao RDS — health retorna `db: connected` |

**MTTR: 4 minutos**

**Alertas disparados:**
- `PodCrashLooping` (DISPARADO/Critico) — `pod=backend-5768c6f755-pcpgq container=backend`
- `KubePodNotReady` (PENDENTE/Aviso) — pods do backend nao ficam prontos
- `DeploymentReplicasMismatch` (DISPARADO/Aviso) — replicas disponiveis < desejadas
- `KubePdbNotEnoughHealthyPods` (PENDENTE/Aviso) — PDB sem pods saudaveis suficientes

**Causa raiz:** revogacao do grant `rds_iam` do usuario `app_user` no PostgreSQL. Sem esse grant, o RDS recusa autenticacao IAM mesmo que o token seja valido — a autorizacao e dupla (IAM + PostgreSQL).

**Por que o 503 foi imediato:**
- A readinessProbe chama `/backend/health` que verifica conexao com o banco
- Sem `rds_iam`, o token IAM e rejeitado pelo RDS (`password authentication failed`)
- O pod sobe mas a probe falha — ALB nao roteia trafego para pods nao prontos

**Resolucao:**
```bash
# 1. Identificar a causa via logs
kubectl logs -l app.kubernetes.io/name=backend -n app | grep -i "error\|auth\|connect"

# 2. Verificar se o app_user tem rds_iam
# (via pod temporario com psql)
kubectl run pg-check --image=postgres:16-alpine --restart=Never -n app \
  --env="PGPASSWORD=<master-pass>" \
  -- psql -h <rds-host> -U dbadmin -d devops_ia \
  -c "SELECT rolname FROM pg_roles WHERE rolname='rds_iam' AND pg_has_role('app_user', oid, 'member');"

# 3. Restaurar o grant
kubectl run pg-restore --image=postgres:16-alpine --restart=Never -n app \
  --env="PGPASSWORD=<master-pass>" \
  -- psql -h <rds-host> -U dbadmin -d devops_ia \
  -c "GRANT rds_iam TO app_user;"

# 4. Reiniciar o deployment para gerar novos tokens IAM
kubectl rollout restart deployment/backend -n app
```

**Licao aprendida:** o CloudWatch alarm `RDSConnectionsHigh` nao captura falhas de autenticacao — o alerta veio dos pods em CrashLoop, nao do banco. Para detectar falhas de autenticacao, seria necessario um alerta baseado nos logs do RDS via CloudWatch Logs Insights.
