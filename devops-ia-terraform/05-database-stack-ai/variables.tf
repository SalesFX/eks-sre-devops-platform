variable "aws_region" {
  description = "AWS region where all resources will be provisioned."
  type        = string
  nullable    = false
}

variable "project" {
  description = "Project settings shared across resources."
  type = object({
    name        = string
    environment = string
  })
  nullable = false
}

variable "cluster" {
  description = "EKS cluster settings used to resolve the OIDC provider for IRSA."
  type = object({
    name = string
  })
  nullable = false
}

variable "database" {
  description = "Configuration for the RDS PostgreSQL instance."
  type = object({
    identifier              = string
    db_name                 = string
    username                = string
    engine_version          = string
    instance_class          = string
    allocated_storage       = number
    backup_retention_period = number
    backup_window           = string
    maintenance_window      = string
    deletion_protection     = bool
    skip_final_snapshot     = bool
  })
  nullable = false
}
