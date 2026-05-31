# Runbook: ArgoCD Sync Failed

**Servico:** GitOps (ArgoCD)
**Severidade:** SEV2 (novos deploys bloqueados, sistema atual continua rodando)
**Tempo estimado de resolucao:** 5 a 30 minutos

---

## Sintomas

- `kubectl get application -n argocd` mostra `SyncStatus: OutOfSync` ou `HealthStatus: Degraded`
- Novo commit em `clean-main` nao e refletido no cluster
- ArgoCD UI mostra erro vermelho na Application `devops-ia`

## Diagnostico

```bash
# Status geral
kubectl get application -n argocd

# Mensagem de erro detalhada
kubectl get application devops-ia -n argocd \
  -o jsonpath='{.status.operationState.message}'

# Condicoes da Application
kubectl get application devops-ia -n argocd \
  -o jsonpath='{.status.conditions}' | python3 -m json.tool

# Logs do ArgoCD controller
kubectl logs -n argocd deploy/argocd-application-controller --tail=50 | grep -i error

# Logs do ArgoCD repo server (problemas de clone/render)
kubectl logs -n argocd deploy/argocd-repo-server --tail=50 | grep -i error
```

## Causas comuns e resolucao

### Causa 1: PreSync Job falhou (migration)

**Indicador:** `hook "backend-migration" failed`.

O Job de migration roda `prisma migrate deploy` antes de cada sync. Se falhar, o sync para.

```bash
# Ver logs do Job de migration
kubectl logs -n app -l job-name=backend-migration

# Verificar status do banco
kubectl run pg-check --rm -it --restart=Never --image=postgres:16-alpine \
  --env="PGPASSWORD=<senha-master>" \
  -- psql "host=<rds-endpoint> port=5432 dbname=devops_ia user=dbadmin sslmode=require" \
  -c "SELECT id, migration_name, finished_at FROM _prisma_migrations ORDER BY started_at DESC LIMIT 5;"

# Se migration tiver erro, resolver o SQL e fazer novo commit
# Deletar o Job travado para o proximo sync tentar novamente
kubectl delete job backend-migration -n app 2>/dev/null
```

### Causa 2: Imagem nao existe no ECR

**Indicador:** pod em `ImagePullBackOff`, ArgoCD em `Degraded`.

```bash
# Verificar tag no kustomization
grep newTag devops-ia-kubernetes/kustomization.yaml

# Confirmar que a imagem existe no ECR
aws ecr list-images \
  --repository-name devops-ia/production/backend \
  --region us-east-1 \
  --query 'imageIds[*].imageTag'
```

Se a tag nao existir, o CI falhou antes de fazer o push. Verificar o run do CI/CD no GitHub Actions.

### Causa 3: Manifesto invalido apos merge

**Indicador:** `ComparisonError` com mensagem de parse YAML.

```bash
# Validar o kustomize localmente
kubectl kustomize devops-ia-kubernetes/ | kubectl apply --dry-run=client -f -
```

### Causa 4: Job immutable field change

**Indicador:** `field is immutable` no erro do ArgoCD.

O spec de um Job existente nao pode ser alterado. Solucao:

```bash
kubectl delete job backend-migration -n app 2>/dev/null
# ArgoCD vai recriar o Job no proximo sync
```

### Causa 5: selfHeal conflitando com mudancas manuais

Se algum `kubectl apply` manual foi feito, o `selfHeal: true` pode entrar em loop tentando reconciliar.

```bash
# Forcar sync manual
kubectl annotate application devops-ia -n argocd \
  argocd.argoproj.io/refresh=normal
```

## Forcando sync manual

```bash
# Via kubectl
kubectl patch application devops-ia -n argocd \
  --type merge \
  -p '{"operation":{"sync":{"revision":"HEAD"}}}'

# Se necessario, sync com prune forcado
argocd app sync devops-ia --prune --force 2>/dev/null
```

## Prevencao

- `activeDeadlineSeconds: 120` no Job de migration evita que fique travado indefinidamente (ja configurado)
- `hook-delete-policy: HookSucceeded` remove o Job apos sucesso, evitando conflito de spec no proximo sync (ja configurado)
- Nunca editar recursos diretamente com `kubectl apply` em recursos gerenciados pelo ArgoCD — sempre via Git
