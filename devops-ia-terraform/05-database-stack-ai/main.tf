provider "aws" {
  region = var.aws_region

  # Workaround WSL2: endpoint global do S3 pode sofrer TLS reset.
  # Forcamos o endpoint regional para evitar timeout no HeadBucket.
  endpoints {
    s3 = "https://s3.${var.aws_region}.amazonaws.com"
  }

  default_tags {
    tags = local.common_tags
  }
}

data "terraform_remote_state" "networking" {
  backend = "s3"
  config = {
    bucket = "devops-ia-production-terraform-state-074994084847"
    key    = "networking/terraform.tfstate"
    region = "us-east-1"
  }
}

data "terraform_remote_state" "eks" {
  backend = "s3"
  config = {
    bucket = "devops-ia-production-terraform-state-074994084847"
    key    = "eks/terraform.tfstate"
    region = "us-east-1"
  }
}

# Resolve the OIDC provider created in stack 04 using the EKS cluster issuer URL.
data "aws_eks_cluster" "this" {
  name = var.cluster.name
}

data "aws_iam_openid_connect_provider" "eks" {
  url = data.aws_eks_cluster.this.identity[0].oidc[0].issuer
}
