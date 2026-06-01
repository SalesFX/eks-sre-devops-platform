# INC-004: Deploy com imagem invalida (ImagePullBackOff)

**Data:** 2026-06-01
**Duracao:** 5 minutos (14:17 a 14:22 BRT)
**Severidade:** Warning (servico continuou no ar — maxUnavailable: 0)
**Status:** Resolved via git revert + kubectl apply -k
**Servicos afetados:** rolling update bloqueado — usuarios nao afetados

## Simulacao em producao — 2026-06-01

| Horario (BRT) | Evento |
|---|---|
| 14:17:22 | kustomization.yaml atualizado com tag inexistente `sha-badimage999` e pushed para clean-main |
| 14:17:25 | ArgoCD detecta mudanca e inicia rolling update |
| 14:17:28 | Novos pods `backend` e `frontend` entram em `ErrImagePull` / `ImagePullBackOff` |
| 14:19:00 | Alertas `KubePodNotReady` e `KubeContainerWaiting` disparam no Grafana (Warning) |
| 14:21:58 | On-call executa `git revert HEAD` e push para clean-main |
| 14:22:16 | Pods voltam ao estado Running — incidente encerrado |

**MTTR: 5 minutos**

**Alertas disparados:**
- `Pod Nao Pronto` (Warning) — novos pods nao conseguem puxar a imagem
- `KubeContainerWaiting: ImagePullBackOff` (Warning) — container aguardando imagem inexistente

**O que funcionou:**
- `maxUnavailable: 0` manteve os pods antigos servindo trafego durante todo o incidente
- Zero downtime para usuarios finais
- `readinessProbe` impediu que pods com erro entrassem no load balancer

**Resolucao:**
```bash
git revert HEAD
git push origin clean-main
kubectl apply -k devops-ia-kubernetes/
```

---

---

## Linha do tempo

| Hora (UTC) | Evento |
|---|---|
| 20:38 | CI conclui build e push da imagem `sha-776cf66` para ECR |
| 20:38 | CI atualiza `kustomization.yaml` com nova tag; ArgoCD detecta mudanca |
| 20:39 | ArgoCD inicia PreSync hook (migration Job): sucesso |
| 20:40 | ArgoCD inicia rolling update do backend: novo pod `sha-776cf66` sobe |
| 20:41 | Novo pod falha em `readinessProbe` (backend nao consegue gerar token IRSA) |
| 20:41 | ALB remove o novo pod do target group; pod antigo continua servindo |
| 20:41 | `ALARM: TypeScript cast error — prisma.ts line 100` nos logs |
| 20:42 | Pod novo reinicia (CrashLoopBackOff) |
| 20:42 | On-call identifica o erro: `Conversion of type 'PrismaClient' to 'Record'` |
| 20:43 | Hotfix commitado; CI inicia build |
| 20:45 | Nova imagem `sha-364357f` deployada; ambos os pods Running |

## Sintomas observados

- ArgoCD Application em `Degraded` durante o rolling update
- Pod novo em `CrashLoopBackOff` com `readinessProbe` falhando
- Pod antigo continuando a servir trafego (RollingUpdate com `maxUnavailable: 0` funcionando corretamente)
- Usuarios NAO perceberam interrupcao — zero downtime durante o incidente

## Causa raiz

A refatoracao do `prisma.ts` para implementar o Proxy de acesso sincrono ao PrismaClient usou um cast TypeScript invalido:

```typescript
// Errado: TypeScript nao permite cast direto de PrismaClient para Record
const value = (prismaExports.prisma as Record<string | symbol, unknown>)[prop]

// Correto: cast via unknown como intermediario
const value = (prismaExports.prisma as unknown as Record<string | symbol, unknown>)[prop]
```

O erro de compilacao TypeScript (`tsc`) foi detectado pelo Dockerfile no passo `RUN npm run build` — o build da imagem falhou com exit code 2. No entanto, o CI nao verificou o exit code do Docker build antes de continuar.

**Bug no CI:** o step de build usava `docker/build-push-action@v6` sem `--no-cache`, o que fez o Docker usar a camada de `npm install` do cache mas re-executar o `tsc`. O step falhou mas a acao do GitHub Actions continuou porque a condicao de erro nao estava configurada corretamente.

Na verdade, o CI **nao publicou a imagem corrompida** — a imagem `sha-776cf66` foi construida mas o `tsc` falhou internamente. O que subiu foi a imagem do **commit anterior** que tambem tinha o mesmo bug pois o Docker cache reaproveitou a camada de build errada de uma execucao anterior.

## Resolucao

```typescript
// prisma.ts — correcao do cast
const value = (prismaExports.prisma as unknown as Record<string | symbol, unknown>)[prop]
```

Novo commit, build limpo (sem cache), push da imagem corrigida `sha-364357f`.

## Impacto real

- Zero downtime para usuarios finais (RollingUpdate com `maxUnavailable: 0` manteve o pod antigo ativo)
- 4 minutos de degradacao do ponto de vista do ArgoCD (Application em Degraded)
- A estrategia de rolling update funcionou exatamente como projetado

## Acoes pos-incidente

- [x] Corrigir o cast TypeScript em `prisma.ts`
- [x] Adicionar `--no-cache` no build do CI para evitar reutilizacao de camadas corrompidas
- [ ] Adicionar step de `tsc --noEmit` (type check sem build) antes do Docker build na pipeline
- [ ] Adicionar teste de smoke no CI: rodar o container localmente e chamar `/backend/health` antes do push para ECR
- [ ] Configurar `matrix` no CI para builds em paralelo com e sem cache para comparar

## Licoes aprendidas

1. `maxUnavailable: 0` no RollingUpdate e a diferenca entre "incidente percebido por usuarios" e "incidente operacional" — zero downtime real
2. O Docker build cache pode propagar bugs entre execucoes — builds criticos de producao devem usar `--no-cache` ou cache invalidado por conteudo
3. Type errors de TypeScript devem ser verificados em step separado da pipeline antes do build da imagem, com feedback rapido ao desenvolvedor
4. `readinessProbe` atuou como gate de qualidade — o pod com bug nunca recebeu trafego real
