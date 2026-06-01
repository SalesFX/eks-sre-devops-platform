# Skills Operacionais

Skills sao procedimentos reutilizaveis definidos em `.claude/skills/`. Cada skill tem escopo bem definido para evitar sobreposicao e garantir que o procedimento correto seja invocado para cada situacao.

## Mapa de Skills

| Skill | Escopo | Situacao de uso |
|---|---|---|
| `terraform-deploy` | Deploy de infraestrutura | Provisionar ou atualizar qualquer stack Terraform |
| `dockerfile-generator` | Containerizacao | Gerar Dockerfile otimizado para uma aplicacao |
| `docker-push-ecr` | Build e publicacao | Buildar e publicar imagem Docker no ECR |
| `resolve-bo-inicial` | Rebuild completo | Recriar toda a infraestrutura do zero |
| `depoveiro` | Saude da aplicacao | Diagnosticar pods, banco, secrets, migration, ArgoCD app |
| `PlantonistaOps` | Saude da infraestrutura | Terraform, EKS nodes, kubectl, ArgoCD sistema |
| `bo-real-prod` | Simulacao de incidentes | Disparar incidentes controlados e observar alertas no Grafana |

## Separacao de responsabilidade: depoveiro vs PlantonistaOps

A separacao mais importante e entre as duas skills de diagnostico:

- **depoveiro**: problema esta na aplicacao. Pods do `backend` ou `frontend` com erro, secret ausente, banco nao conecta, migration falhou, ArgoCD Application `devops-ia` fora de sync.

- **PlantonistaOps**: problema esta na infraestrutura. Terraform travado, EKS node group com falha, kubectl sem credenciais, ArgoCD sistema (dex, CNI) com problema.

## Cadeia de uso em incidente real

```
Problema detectado no Grafana
        |
        +-- App com erro? --> depoveiro
        |
        +-- Infra com problema? --> PlantonistaOps
        |
        +-- Precisou rebuild? --> resolve-bo-inicial
        |
        +-- Quero simular? --> bo-real-prod
```

## Design das skills

Cada skill define seu proprio escopo e palavras-chave de ativacao na descricao, garantindo que o modelo correto seja invocado automaticamente baseado no contexto da conversa. As skills de diagnostico indicam explicitamente quando NAO devem ser usadas, redirecionando para a skill correta.
