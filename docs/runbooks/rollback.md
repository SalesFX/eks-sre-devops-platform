# Runbook: Rollback de Deployment

**Quando usar:** novo deploy causou regressao (erro 500, crash de pods, falha de health check)
**Severidade:** qualquer
**Tempo estimado:** 3 a 10 minutos

---

## Principio

Neste projeto, o rollback e feito via Git + ArgoCD (GitOps). **Nunca** use `kubectl rollout undo` diretamente em um ambiente gerenciado pelo ArgoCD com `selfHeal: true` — o ArgoCD vai reverter a mudanca manual em segundos.

O unico rollback valido e reverter o commit no Git. O ArgoCD sincroniza automaticamente.

---

## Identificar o commit a reverter

```bash
# Ver historico do kustomization (onde ficam as tags de imagem)
git log --oneline devops-ia-kubernetes/kustomization.yaml

# Ver qual tag esta atual no cluster
kubectl get application devops-ia -n argocd \
  -o jsonpath='{.status.sync.revision}'

# Confirmar a tag da imagem atual
kubectl get pods -n app -l app.kubernetes.io/name=backend \
  -o jsonpath='{.items[0].spec.containers[0].image}'
```

## Rollback de imagem (causa mais comum)

```bash
# Reverter o commit de atualizacao de tag
git revert <commit-sha-do-ci-que-atualizou-a-tag> --no-edit
git push origin clean-main
# ArgoCD detecta o novo commit e sincroniza automaticamente
# Aguardar: kubectl get application devops-ia -n argocd -w
```

## Rollback de manifesto (mudanca em deployment, service, etc.)

```bash
# Reverter o commit especifico da mudanca
git revert <commit-sha> --no-edit
git push origin clean-main
```

## Rollback de migracao de banco (cuidado)

Migrations Prisma nao tem rollback automatico. Se uma migration causou problema:

```bash
# 1. Reverter o codigo para a versao anterior (imagem anterior)
git revert <commit-sha-da-migration> --no-edit
git push origin clean-main

# 2. Conectar ao banco e desfazer a migration manualmente
# (SQL inverso da migration — DROP TABLE, ALTER TABLE etc.)
# Documentar o SQL de rollback ANTES de aplicar qualquer migration

# 3. Remover o registro da migration da tabela de controle
kubectl run pg-rollback --rm -it --restart=Never \
  --image=postgres:16-alpine \
  --env="PGPASSWORD=<senha-master>" \
  -- psql "host=<rds-endpoint> port=5432 dbname=devops_ia user=dbadmin sslmode=require" \
  -c "DELETE FROM _prisma_migrations WHERE migration_name = '<nome-da-migration>';"
```

## Verificar que o rollback funcionou

```bash
# 1. Confirmar que o ArgoCD sincronizou
kubectl get application devops-ia -n argocd

# 2. Confirmar a imagem revertida
kubectl get pods -n app -o jsonpath='{.items[*].spec.containers[0].image}'

# 3. Testar o health check
curl -sf http://<alb-endpoint>/backend/health

# 4. Testar a rota que estava falhando
```

## Contingencia de IRSA (autenticacao IAM com banco)

Se o problema for especifico da autenticacao IRSA (token expirando, role com permissao incorreta), o fallback temporario e reintroduzir `DATABASE_URL` com a senha do master via Secrets Manager:

```bash
# Obter a senha atual do master
aws secretsmanager get-secret-value \
  --secret-id <arn-do-secret-master> \
  --region us-east-1 \
  --query SecretString

# Atualizar o Secret no cluster (temporario, nao commitar)
kubectl patch secret backend-secrets -n app \
  --type merge \
  -p '{"data":{"database-url":"<base64-da-connection-string-com-senha>"}}'

# Adicionar DATABASE_URL de volta ao deployment temporariamente
# Via patch direto (ArgoCD vai reverter quando sincronizar, entao desabilitar o selfHeal primeiro)
kubectl patch application devops-ia -n argocd \
  --type merge \
  -p '{"spec":{"syncPolicy":{"automated":null}}}'
```

> Este e um modo de contingencia. Assim que o IRSA for corrigido, reabilitar o auto-sync e remover a senha estatica.

## Pos-rollback

1. Criar um incidente no Incident Tracker documentando o problema
2. Abrir issue no repositorio com a causa raiz
3. Corrigir o problema em uma nova branch antes de tentar o deploy novamente
