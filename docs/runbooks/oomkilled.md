# Runbook: OOMKilled

**Servico:** backend ou qualquer pod no namespace `app`
**Severidade:** SEV2 (degradacao parcial do servico)
**Tempo estimado de resolucao:** 10 a 30 minutos

---

## Sintomas

- Pod em `CrashLoopBackOff` com razao `OOMKilled`
- `kubectl describe pod <nome>` mostra `Reason: OOMKilled` em `Last State`
- Alarme CloudWatch `rds-memory-low` pode disparar em conjunto se o banco estiver sofrendo pressao de conexoes acumuladas

## Diagnostico

```bash
# Identificar pods OOMKilled
kubectl get pods -n app -o wide
kubectl describe pod <nome-do-pod> -n app | grep -A5 "Last State"

# Ver uso de memoria atual do Deployment
kubectl top pods -n app

# Ver eventos do namespace
kubectl get events -n app --sort-by=.lastTimestamp | tail -20

# Ver logs antes do crash
kubectl logs <nome-do-pod> -n app --previous | tail -50
```

## Causas comuns

| Causa | Indicador |
|---|---|
| Limite de memoria muito baixo | `limits.memory` abaixo de 256Mi para o backend |
| Memory leak na aplicacao | Memoria crescendo continuamente antes do crash |
| Query Prisma retornando dataset grande sem paginacao | Logs mostrando query lenta antes do OOM |
| Muitas conexoes IAM token em flight simultaneamente | Muitos logs de refresh de token |

## Resolucao

### 1. Aumentar o limite temporariamente (mitigacao rapida)

Editar `devops-ia-kubernetes/backend/deployment.yaml`:

```yaml
resources:
  requests:
    cpu: "100m"
    memory: "256Mi"
  limits:
    cpu: "500m"
    memory: "768Mi"   # era 512Mi
```

Commitar e aguardar ArgoCD sincronizar.

### 2. Investigar a causa raiz

```bash
# Ver metricas historicas de memoria no Grafana
# Dashboard: Kubernetes / Compute Resources / Pod
# Namespace: app, Pod: backend-*

# Verificar se ha query sem LIMIT no codigo
grep -r "findMany\|findAll" devops-ia-apps/backend/src/ | grep -v "take:\|limit:"
```

### 3. Verificar conexoes acumuladas no RDS

```bash
# Checar alarme CloudWatch
aws cloudwatch get-metric-statistics \
  --namespace AWS/RDS \
  --metric-name DatabaseConnections \
  --dimensions Name=DBInstanceIdentifier,Value=devops-ia-production \
  --start-time $(date -u -d '30 minutes ago' +%Y-%m-%dT%H:%M:%S) \
  --end-time $(date -u +%Y-%m-%dT%H:%M:%S) \
  --period 60 --statistics Maximum \
  --region us-east-1
```

## Prevencao

- Monitorar `container_memory_working_set_bytes` no Grafana com alerta em 80% do limite
- Implementar paginacao em todas as queries Prisma (`take` + `skip` ou cursor)
- Revisar o refresh cycle do IRSA token: garantir que o cliente antigo seja desconectado antes de criar o novo

## Rollback

Se o aumento de memoria nao resolver (sinal de memory leak real):

```bash
# Reverter para imagem anterior via kustomization
git log devops-ia-kubernetes/kustomization.yaml
git revert <commit-da-imagem-atual>
git push origin clean-main
# ArgoCD sincroniza automaticamente
```
