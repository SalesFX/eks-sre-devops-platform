---
name: bo-real-prod
description: |
  Simula incidentes reais de producao na plataforma devops-ia: dispara o problema, monitora o
  alerta aparecer no Grafana, executa a resolucao e documenta o MTTR.
  Use esta skill quando o usuario quiser testar o sistema de alertas, simular uma falha,
  ver o Grafana em acao, reproduzir um incidente, demonstrar incident response, ou quando
  baixou o repositorio e quer ver como os alertas funcionam na pratica.
  Palavras-chave: simular incidente, testar alerta, ver Grafana disparar, demonstrar SRE,
  reproduzir falha, bo de producao, chaos engineering, INC-001, INC-002, INC-003, INC-004,
  quero ver um alerta critico, simular OOM, simular RDS fora do ar, simular imagem errada.
---

# bo-real-prod - Simulacao de Incidentes em Producao

Guia completo para simular os 4 incidentes reais documentados nesta plataforma.
Cada simulacao segue o ciclo SRE: trigger, deteccao via alerta, resolucao, MTTR.

## Pre-requisitos

```bash
# 1. Cluster funcionando
kubectl get nodes  # deve mostrar 4 nodes Ready

# 2. App no ar
curl -s http://k8s-app-devopsia-a05a05588d-1756438931.us-east-1.elb.amazonaws.com/backend/health
# Esperado: {"status":"ok","db":"connected"}

# 3. VMRule de demo aplicada (thresholds de 30s-1m)
kubectl apply -f devops-ia-kubernetes/demo-alerts-vmrule.yaml
kubectl get vmrule devops-ia-demo-alerts -n monitoring
# STATUS deve ser: operational

# 4. Grafana acessivel
kubectl port-forward svc/vm-grafana -n monitoring 3000:80 &
# Abrir http://localhost:3000 (home = Platform Alerts dashboard)
```

---

## Perguntar qual incidente simular

Se o usuario nao especificou, perguntar:

> Qual incidente voce quer simular?
> - INC-004: Deploy com imagem invalida (Warning, servico fica no ar)
> - INC-003: Secret ausente - backend nao inicia (Warning, servico fica no ar)
> - INC-002: OOMKilled - container sem memoria (Critical, pod em crashloop)
> - INC-001: RDS indisponivel - banco inacessivel (Critical, 503 total)
> - Todos em sequencia (INC-004 -> INC-003 -> INC-002 -> INC-001)

---

## INC-004: Deploy com Imagem Invalida

**Severidade:** Aviso | **MTTR esperado:** 5-6 min | **Impacto:** zero (servico continua no ar)

**O que acontece:** novos pods entram em `ImagePullBackOff`, pods antigos continuam servindo.
O `maxUnavailable: 0` do RollingUpdate protege o servico.

### Trigger

```bash
TRIGGER=$(date "+%H:%M:%S")
echo "INC-004 TRIGGER: $TRIGGER"

kubectl set image deployment/backend \
  backend=074994084847.dkr.ecr.us-east-1.amazonaws.com/devops-ia/production/backend:sha-badimage999 \
  -n app
kubectl set image deployment/frontend \
  frontend=074994084847.dkr.ecr.us-east-1.amazonaws.com/devops-ia/production/frontend:sha-badimage999 \
  -n app
```

### Monitorar

```bash
# Pods com erro (novos) e pods saudaveis (antigos)
kubectl get pods -n app -w

# Confirmar servico continua no ar
curl -s http://k8s-app-devopsia-a05a05588d-1756438931.us-east-1.elb.amazonaws.com/backend/health
```

Aguardar ~1 min: alertas `ContainerImagePullFailed` (imagem nao encontrada) e `KubePodNotReady` aparecem no Grafana.

### Resolucao (boa pratica - GitOps)

```bash
# Forma correta: reverter via git
git revert HEAD && git push origin clean-main
# ArgoCD sincroniza automaticamente

# Forma rapida (imperativa - requer git revert depois para manter GitOps)
kubectl set image deployment/backend \
  backend=074994084847.dkr.ecr.us-east-1.amazonaws.com/devops-ia/production/backend:sha-da9bf41 -n app
kubectl set image deployment/frontend \
  frontend=074994084847.dkr.ecr.us-east-1.amazonaws.com/devops-ia/production/frontend:sha-da9bf41 -n app
```

### Verificacao

```bash
kubectl get pods -n app  # todos 1/1 Running
curl -s http://k8s-app-devopsia-a05a05588d-1756438931.us-east-1.elb.amazonaws.com/backend/health
# {"status":"ok","db":"connected"}
```

---

## INC-003: Secret Ausente

**Severidade:** Aviso | **MTTR esperado:** 5 min | **Impacto:** zero (pods antigos continuam)

**O que acontece:** Kubernetes nao consegue nem criar o container (`CreateContainerConfigError`).

### Trigger

```bash
TRIGGER=$(date "+%H:%M:%S")
echo "INC-003 TRIGGER: $TRIGGER"

kubectl delete secret backend-secrets -n app
kubectl rollout restart deployment/backend -n app
```

### Monitorar

```bash
kubectl get pods -n app | grep backend
# Novo pod deve mostrar CreateContainerConfigError
kubectl describe pod -l app.kubernetes.io/name=backend -n app | grep -A3 "Events:"
```

Aguardar ~30s: alerta `ContainerConfigError` dispara no Grafana (Aviso) com o nome do pod e o motivo `CreateContainerConfigError`.

### Resolucao

```bash
# Gerar token IAM fresco (expira em 15 min)
aws rds generate-db-auth-token \
  --hostname devops-ia-production.cqfcm424geyn.us-east-1.rds.amazonaws.com \
  --port 5432 --region us-east-1 --username app_user > /tmp/iam_token.txt

DATABASE_URL=$(python3 - <<'EOF'
import urllib.parse
with open('/tmp/iam_token.txt') as f:
    token = f.read().strip()
encoded = urllib.parse.quote(token, safe='')
print(f"postgresql://app_user:{encoded}@devops-ia-production.cqfcm424geyn.us-east-1.rds.amazonaws.com:5432/devops_ia?sslmode=require")
EOF
)
rm -f /tmp/iam_token.txt

kubectl create secret generic backend-secrets \
  --from-literal=database-url="$DATABASE_URL" \
  --from-literal=jwt-secret="$(openssl rand -base64 32)" \
  -n app --dry-run=client -o yaml | kubectl apply -f -

kubectl rollout restart deployment/backend -n app
```

### Verificacao

```bash
kubectl get pods -n app  # todos 1/1 Running
```

---

## INC-002: Container OOMKilled

**Severidade:** Critico | **MTTR esperado:** 4 min | **Impacto:** pod em CrashLoop

**O que acontece:** kernel Linux mata o container com `SIGKILL` (exit code 137) por exceder
o memory limit. O Kubernetes tenta reiniciar continuamente: `CrashLoopBackOff`.

### Trigger

```bash
TRIGGER=$(date "+%H:%M:%S")
echo "INC-002 TRIGGER: $TRIGGER"

cat <<'EOF' | kubectl apply -f -
apiVersion: v1
kind: Pod
metadata:
  name: oom-demo
  namespace: app
  labels:
    app: oom-demo
spec:
  restartPolicy: Always
  containers:
  - name: memory-hog
    image: node:20-alpine
    command: ["node", "-e", "const x=[];while(true){x.push(Buffer.alloc(1024*1024*10))}"]
    resources:
      requests:
        memory: "5Mi"
        cpu: "10m"
      limits:
        memory: "10Mi"
        cpu: "200m"
EOF
```

### Monitorar

```bash
kubectl get pod oom-demo -n app -w
# Deve mostrar OOMKilled -> CrashLoopBackOff

kubectl describe pod oom-demo -n app | grep -A3 "Last State"
# Reason: OOMKilled
# Exit Code: 137
```

Aguardar ~30s: alertas `ContainerOOMKilled` (Critico) e `PodCrashLooping` (Critico) no Grafana.
Esses aparecem em VERMELHO - e o alerta mais impactante visualmente.

### Resolucao

```bash
# Deletar o pod de demo
kubectl delete pod oom-demo -n app

# Em producao real com Deployment:
# kubectl set resources deployment backend --limits=memory=512Mi --requests=memory=128Mi -n app
# ou
# kubectl rollout undo deployment/backend -n app
```

### Verificacao

```bash
kubectl get pods -n app  # oom-demo nao deve aparecer
# Aguardar ~5 min para alertas expirarem no Grafana
```

---

## INC-001: RDS Indisponivel

**Severidade:** Critico | **MTTR esperado:** 4 min | **Impacto:** 503 total no ALB

**O que acontece:** sem `rds_iam`, o RDS rejeita o token IAM mesmo sendo valido.
A `readinessProbe` falha, o pod fica `0/1 Ready`, e o ALB para de rotear trafego.

### Pre-requisito: obter senha master

```bash
MASTER_SECRET_ARN=$(cd /home/samuelsales/DevOps-Nuvem/aws-project-sre-devops/devops-ia-terraform/05-database-stack-ai && \
  terraform output -raw db_master_user_secret_arn)
MASTER_PASS=$(aws secretsmanager get-secret-value --secret-id "$MASTER_SECRET_ARN" \
  --query 'SecretString' --output text | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['password'])")
echo "Senha master obtida"
```

### Trigger

```bash
TRIGGER=$(date "+%H:%M:%S")
echo "INC-001 TRIGGER: $TRIGGER"

kubectl run pg-revoke --image=postgres:16-alpine --restart=Never -n app \
  --env="PGPASSWORD=$MASTER_PASS" \
  -- psql -h devops-ia-production.cqfcm424geyn.us-east-1.rds.amazonaws.com \
  -U dbadmin -d devops_ia -c "REVOKE rds_iam FROM app_user;"

sleep 8 && kubectl logs pg-revoke -n app && kubectl delete pod pg-revoke -n app --force

# Forcear reconexao dos pods
kubectl delete pods -n app -l app.kubernetes.io/name=backend
```

### Monitorar

```bash
# Servico deve retornar 503
curl -s http://k8s-app-devopsia-a05a05588d-1756438931.us-east-1.elb.amazonaws.com/backend/health

# Pods com readinessProbe falhando
kubectl get pods -n app | grep backend
# backend-xxx   0/1   Running   1   30s  <- nao pronto
```

Aguardar ~30s-1min: alertas `PodCrashLooping` (Critico) e `DeploymentReplicasMismatch` no Grafana.

### Resolucao

```bash
# 1. Restaurar o grant
kubectl run pg-restore --image=postgres:16-alpine --restart=Never -n app \
  --env="PGPASSWORD=$MASTER_PASS" \
  -- psql -h devops-ia-production.cqfcm424geyn.us-east-1.rds.amazonaws.com \
  -U dbadmin -d devops_ia -c "GRANT rds_iam TO app_user;"

sleep 8 && kubectl logs pg-restore -n app && kubectl delete pod pg-restore -n app --force

# 2. Reiniciar backend para gerar novos tokens
kubectl rollout restart deployment/backend -n app
```

### Verificacao

```bash
kubectl get pods -n app  # backend 1/1 Running
curl -s http://k8s-app-devopsia-a05a05588d-1756438931.us-east-1.elb.amazonaws.com/backend/health
# {"status":"ok","db":"connected"}
```

---

## Documentar o MTTR

Ao final de cada incidente, registrar:

```
Incidente: INC-00X
Trigger:   HH:MM:SS
Alerta:    HH:MM:SS (tempo ate aparecer no Grafana)
Resolucao: HH:MM:SS
MTTR:      X minutos
```

Os arquivos de incidente ficam em `docs/incidents/INC-00X-*.md`.

---

## Limpeza pos-simulacao

```bash
# Verificar que nenhum pod de demo sobrou
kubectl get pods -n app
# Deve mostrar apenas: backend (2 pods), frontend (2 pods), migration (Completed)

# Verificar que o Grafana esta limpo (sem alertas app)
# Aguardar ~5 min para os alertas expirarem apos a resolucao
```
