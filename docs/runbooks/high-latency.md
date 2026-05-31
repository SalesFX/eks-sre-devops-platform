# Runbook: High Latency

**Servico:** backend ou frontend via ALB
**Severidade:** SEV2 (degradacao de performance)
**Tempo estimado de resolucao:** 15 a 45 minutos

---

## Sintomas

- Requests ao ALB demorando mais de 2 segundos
- Grafana mostrando `http_request_duration_seconds` elevado
- Usuarios relatando lentidao ou timeouts intermitentes
- ALB health checks passando mas latencia alta (503 ainda nao, mas caminhando para isso)

## Diagnostico inicial

```bash
# Testar latencia atual do endpoint de health
time curl -sf http://<alb-endpoint>/backend/health

# Ver uso de recursos dos pods
kubectl top pods -n app
kubectl top nodes

# Eventos recentes
kubectl get events -n app --sort-by=.lastTimestamp | tail -30
```

## Identificar a camada com problema

### Verificar se e o banco (causa mais comum)

```bash
# Latencia do RDS via CloudWatch
aws cloudwatch get-metric-statistics \
  --namespace AWS/RDS \
  --metric-name ReadLatency \
  --dimensions Name=DBInstanceIdentifier,Value=devops-ia-production \
  --start-time $(date -u -d '30 minutes ago' +%Y-%m-%dT%H:%M:%S) \
  --end-time $(date -u +%Y-%m-%dT%H:%M:%S) \
  --period 60 --statistics Average \
  --region us-east-1

# Conexoes ativas no banco
aws cloudwatch get-metric-statistics \
  --namespace AWS/RDS --metric-name DatabaseConnections \
  --dimensions Name=DBInstanceIdentifier,Value=devops-ia-production \
  --start-time $(date -u -d '15 minutes ago' +%Y-%m-%dT%H:%M:%S) \
  --end-time $(date -u +%Y-%m-%dT%H:%M:%S) \
  --period 60 --statistics Maximum --region us-east-1
```

### Verificar se e CPU do node

```bash
kubectl describe nodes | grep -A5 "Allocated resources"
# Se CPU requests > 80% da capacidade do node, ha throttling
```

### Verificar se e o refresh do token IRSA causando bloqueio

O refresh do token IRSA recria o PrismaClient a cada 13 minutos. Durante a transicao, queries podem aguardar o novo cliente ficar disponivel.

```bash
kubectl logs -n app deploy/backend | grep "\[prisma\]" | tail -20
# Verificar se os timestamps de refresh coincidem com os picos de latencia
```

## Resolucao por causa

### Causa: query lenta no banco

```bash
# Conectar ao banco e ver queries lentas
kubectl run pg-debug --rm -it --restart=Never --image=postgres:16-alpine \
  --env="PGPASSWORD=<senha-master>" \
  -- psql "host=<rds-endpoint> port=5432 dbname=devops_ia user=dbadmin sslmode=require" \
  -c "SELECT pid, now() - query_start AS duration, query FROM pg_stat_activity WHERE state = 'active' ORDER BY duration DESC LIMIT 10;"
```

Adicionar index se necessario, ou adicionar `take` na query Prisma para limitar resultado.

### Causa: CPU throttling nos pods

Aumentar o limite de CPU temporariamente em `backend/deployment.yaml`:

```yaml
resources:
  limits:
    cpu: "1000m"   # era 500m
```

### Causa: IP exhaustion causando lentidao no scheduling

```bash
kubectl describe nodes | grep "Allocatable" -A5
# Se IPs disponiveis < 5 por node, pods novos ficam Pending causando redistribuicao
```

### Causa: ALB target group com instancias unhealthy

```bash
aws elbv2 describe-target-health \
  --target-group-arn $(aws elbv2 describe-target-groups \
    --query 'TargetGroups[?contains(TargetGroupName, `devops-ia`)].TargetGroupArn' \
    --output text --region us-east-1) \
  --region us-east-1
```

## Prevencao

- Dashboard Grafana com `http_request_duration_p99` por rota — alerta em > 1s
- Paginacao obrigatoria em todas as queries Prisma
- `podAntiAffinity` garante que replicas do backend estejam em nodes diferentes (ja configurado)
- Revisar o impacto do refresh IRSA: garantir que o cliente antigo continue servindo requests ate o novo estar pronto
