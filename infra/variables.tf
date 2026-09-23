variable "region" {
  type        = string
  description = "AWS region for all resources"
  default     = "sa-east-1"
}

# D-04: two AZs
variable "availability_zones" {
  type        = list(string)
  description = "Availability zones used for subnets (exactly two)"
  default     = ["sa-east-1a", "sa-east-1b"]

  validation {
    condition     = length(var.availability_zones) == 2
    error_message = "Exactly two availability zones are required."
  }
}

variable "vpc_cidr" {
  type        = string
  description = "CIDR block of the VPC"
  default     = "10.0.0.0/16"
}

variable "public_subnet_cidrs" {
  type        = list(string)
  description = "CIDRs of the two public subnets (ALB, NAT)"
  default     = ["10.0.0.0/24", "10.0.1.0/24"]

  validation {
    condition     = length(var.public_subnet_cidrs) == 2
    error_message = "Exactly two public subnet CIDRs are required."
  }
}

variable "private_subnet_cidrs" {
  type        = list(string)
  description = "CIDRs of the two private subnets (ECS tasks, RDS)"
  default     = ["10.0.10.0/24", "10.0.11.0/24"]

  validation {
    condition     = length(var.private_subnet_cidrs) == 2
    error_message = "Exactly two private subnet CIDRs are required."
  }
}

variable "ecr_repository_name" {
  type        = string
  description = "Name of the existing ECR repository holding the API image"
  default     = "financial-control-api"
}

variable "image_tag" {
  type        = string
  description = "Immutable image tag (git SHA) deployed to ECS"
  default     = "c0ebba2"

  validation {
    condition     = var.image_tag != "latest"
    error_message = "image_tag must be an immutable git-SHA-style tag, not 'latest'."
  }
}

variable "desired_count" {
  type        = number
  description = "Number of ECS tasks (one per AZ)"
  default     = 2
}

variable "task_cpu" {
  type        = number
  description = "Fargate task CPU units"
  default     = 256
}

variable "task_memory" {
  type        = number
  description = "Fargate task memory in MiB"
  default     = 512
}

variable "allowed_origins" {
  type        = string
  description = "CORS allowed origins passed to the API"
  default     = "http://localhost:3000"
}

# D-09: only the secret name; the value never enters Terraform
variable "jwt_secret_name" {
  type        = string
  description = "Name of the Secrets Manager secret holding the JWT signing secret"
  default     = "financial-control/jwt-access-secret"
}

variable "log_retention_days" {
  type        = number
  description = "CloudWatch Logs retention in days"
  default     = 7
}
