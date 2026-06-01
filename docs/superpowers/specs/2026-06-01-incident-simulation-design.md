# Incident Simulation Design

**Data:** 2026-06-01
**Objetivo:** Simular 4 incidentes reais de producao com ciclo SRE completo para o portfolio

## Sequencia

| # | Incidente | Severidade | Trigger | Alerta |
|---|---|---|---|---|
| 1 | INC-004: Deploy com imagem invalida | Warning | kustomization.yaml com tag sha-badimage999 | KubeDeploymentReplicasMismatch + KubePodNotReady |
| 2 | INC-003: Backend crashando | Warning | Deletar backend-secrets | KubePodNotReady + KubeContainerWaiting |
| 3 | INC-002: OOMKilled | Critical | Memory limit de 10Mi no backend | KubePodCrashLooping |
| 4 | INC-001: RDS Indisponivel | Critical | Revogar rds_iam do app_user | KubePodCrashLooping + KubeDeploymentReplicasMismatch |

## Thresholds

VMRule de demo com `for: 2m` em vez dos 15m padrao.
Removida apos a simulacao.

## Ciclo por incidente

TRIGGER -> aguardar 2 min -> ALERTA no Grafana -> screenshot -> resolver -> screenshot limpo -> MTTR no INC-00X.md

## Entregaveis

- 4 screenshots de alerta
- 4 screenshots de resolucao
- INC-001 a INC-004 atualizados com MTTR real
- Secao "Incident Response em Producao" no README
