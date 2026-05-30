locals {
  common_tags = {
    Environment = var.project.environment
    Project     = var.project.name
    ManagedBy   = "terraform"
    Stack       = "database"
    ADR         = "ADR-0013"
  }
}
