# D-01: single Terraform root module, one environment, no child modules
terraform {
  required_version = ">= 1.11"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
  }

  # D-03: remote state, native S3 lockfile (no DynamoDB). Backend blocks cannot use variables.
  backend "s3" {
    bucket       = "financial-control-tfstate-796897109626"
    key          = "financial-control/infra.tfstate"
    region       = "sa-east-1"
    encrypt      = true
    use_lockfile = true
  }
}

provider "aws" {
  region = var.region

  default_tags {
    tags = {
      Project     = "financial-control"
      ManagedBy   = "terraform"
      Environment = "personal"
    }
  }
}
