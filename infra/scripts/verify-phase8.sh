#!/usr/bin/env bash
# Phase 8 live-stack proof (re-runnable). Run from the repo root.
#   SC1  (ROADMAP criterion 1): private-only exposure   -> SC1_OK
#   SC2  (ROADMAP criterion 2, D-08/D-09): secrets only at runtime -> SC2_OK
#   TF   (idempotency): terraform plan has no drift      -> TF_CLEAN
#   SC3  (ROADMAP criterion 3): health-gated routing     -> SC3_OK
# SKIP_STOP_TASK=1 skips the disruptive stop-task routing test.
# Never prints secret values: they live in shell variables, are compared with
# grep -qF --, and are unset at the end (T-08-15).
set -u
export PATH="$PATH:/c/Terraform"
export MSYS_NO_PATHCONV=1 PYTHONIOENCODING=utf-8 PYTHONUTF8=1
R=sa-east-1

fail() { echo "FAIL: $*" >&2; exit 1; }
tf_out() { terraform -chdir=infra output -raw "$1" 2>/dev/null; }
# node JSON helper: reads JSON on stdin, evaluates expression j (parsed) and prints result
jq_() { node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const j=JSON.parse(s);const r=($1);console.log(typeof r==='string'?r:JSON.stringify(r))})"; }

ALB=$(tf_out alb_dns_name) || fail "terraform output alb_dns_name"
CLUSTER=$(tf_out ecs_cluster_name) || fail "output ecs_cluster_name"
SERVICE=$(tf_out ecs_service_name) || fail "output ecs_service_name"
FAMILY=$(tf_out task_definition_family) || fail "output task_definition_family"
TASK_SG=$(tf_out task_security_group_id) || fail "output task_security_group_id"
RDS_EP=$(tf_out rds_endpoint) || fail "output rds_endpoint"
RDS_SECRET_ARN=$(tf_out rds_master_secret_arn) || fail "output rds_master_secret_arn"
SUBNETS=$(terraform -chdir=infra output -json private_subnet_ids | jq_ "j.join(' ')")
[ -n "$ALB" ] && [ -n "$SUBNETS" ] && [ -n "$RDS_EP" ] || fail "empty terraform outputs"
RDS_HOST=${RDS_EP%%:*}

# ---------------- SC1 ----------------
DB=$(aws rds describe-db-instances --region $R --db-instance-identifier financial-control-db --query 'DBInstances[0]' --output json) || fail "describe rds"
echo "$DB" | jq_ "(j.PubliclyAccessible===false&&j.StorageEncrypted===true&&j.MultiAZ===false&&j.DBInstanceClass==='db.t4g.micro'&&j.Engine==='postgres'&&j.EngineVersion.startsWith('16'))?'ok':'bad'" | grep -qx ok || fail "RDS attributes (public/encrypted/multiaz/class/engine)"

PUBIP=$(aws ecs describe-services --region $R --cluster "$CLUSTER" --services "$SERVICE" --query 'services[0].networkConfiguration.awsvpcConfiguration.assignPublicIp' --output text)
[ "$PUBIP" = "DISABLED" ] || fail "service assignPublicIp is $PUBIP"

for S in $SUBNETS; do
  RT=$(aws ec2 describe-route-tables --region $R --filters "Name=association.subnet-id,Values=$S" --output json)
  echo "$RT" | jq_ "(()=>{const rs=[].concat(...j.RouteTables.map(t=>t.Routes));const igw=rs.some(r=>(r.GatewayId||'').startsWith('igw-'));const nat=rs.some(r=>r.DestinationCidrBlock==='0.0.0.0/0'&&(r.NatGatewayId||'').startsWith('nat-'));return (!igw&&nat)?'ok':'bad'})()" | grep -qx ok || fail "private subnet $S route table (igw present or no nat default route)"
done

sg_id() { aws ec2 describe-security-groups --region $R --filters "Name=group-name,Values=$1" --query 'SecurityGroups[0].GroupId' --output text; }
sg_check() { # name port expected-source-sg
  aws ec2 describe-security-groups --region $R --filters "Name=group-name,Values=$1" --output json | jq_ "(()=>{const p=j.SecurityGroups[0].IpPermissions;return (p.length===1&&p[0].FromPort===$2&&p[0].ToPort===$2&&p[0].IpProtocol==='tcp'&&p[0].IpRanges.length===0&&p[0].Ipv6Ranges.length===0&&p[0].UserIdGroupPairs.length===1&&p[0].UserIdGroupPairs[0].GroupId==='$3')?'ok':'bad'})()" | grep -qx ok
}
RDS_SG=$(sg_id financial-control-rds-sg); ALB_SG=$(sg_id financial-control-alb-sg); TASK_SG_NAME=$(sg_id financial-control-task-sg)
[ "$TASK_SG_NAME" = "$TASK_SG" ] || fail "task SG lookup mismatch"
sg_check financial-control-rds-sg 5432 "$TASK_SG" || fail "RDS SG ingress must be 5432 from task SG only"
sg_check financial-control-task-sg 3000 "$ALB_SG" || fail "task SG ingress must be 3000 from ALB SG only"

node -e "require('dns').lookup('$RDS_HOST',{family:4},(e,a)=>{process.exit(!e&&a&&a.startsWith('10.0.')?0:1)})" || fail "RDS endpoint does not resolve to 10.0.x.x"
echo SC1_OK

# ---------------- SC2 ----------------
TD=$(aws ecs describe-task-definition --region $R --task-definition "$FAMILY" --query 'taskDefinition.containerDefinitions[0]' --output json) || fail "describe task definition"
echo "$TD" | jq_ "(()=>{const s=j.secrets||[];const e=(j.environment||[]);const names=s.map(x=>x.name).sort().join(',');const en=e.map(x=>x.name);const pre='arn:aws:secretsmanager:sa-east-1:796897109626:secret:';const by=n=>(s.find(x=>x.name===n)||{}).valueFrom||'';const ev=n=>(e.find(x=>x.name===n)||{}).value;return (names==='DB_PASSWORD,DB_USER,JWT_ACCESS_SECRET'&&s.every(x=>x.valueFrom.startsWith(pre))&&by('DB_USER').endsWith(':username::')&&by('DB_PASSWORD').endsWith(':password::')&&!['DB_PASSWORD','DB_USER','JWT_ACCESS_SECRET'].some(n=>en.includes(n))&&ev('PGSSLMODE')==='no-verify'&&['DB_HOST','DB_PORT','DB_NAME'].every(n=>en.includes(n)))?'ok':'bad'})()" | grep -qx ok || fail "task definition secrets/environment shape"

STATE=$(terraform -chdir=infra state pull) || fail "state pull"
JWT_ARN=$(echo "$TD" | jq_ "j.secrets.find(x=>x.name==='JWT_ACCESS_SECRET').valueFrom")
JWT_VAL=$(aws secretsmanager get-secret-value --region $R --secret-id "$JWT_ARN" --query SecretString --output text) || fail "read jwt secret"
DB_PW=$(aws secretsmanager get-secret-value --region $R --secret-id "$RDS_SECRET_ARN" --query SecretString --output text | jq_ "j.password")
[ -n "$JWT_VAL" ] && [ -n "$DB_PW" ] || fail "could not load secret values for comparison"
if printf '%s' "$TD" | grep -qF -- "$JWT_VAL"; then fail "JWT secret value present in task definition"; fi
if printf '%s' "$TD" | grep -qF -- "$DB_PW"; then fail "RDS password present in task definition"; fi
if printf '%s' "$STATE" | grep -qF -- "$JWT_VAL"; then fail "JWT secret value present in terraform state"; fi
if printf '%s' "$STATE" | grep -qF -- "$DB_PW"; then fail "RDS password present in terraform state"; fi
if printf '%s' "$STATE" | grep -qE '"password": "'; then fail "non-null password attribute in terraform state"; fi
unset JWT_VAL DB_PW STATE TD
echo SC2_OK

# ---------------- TF_CLEAN ----------------
terraform -chdir=infra plan -detailed-exitcode -input=false -no-color >/dev/null 2>&1
TFRC=$?
[ "$TFRC" = "0" ] || fail "terraform plan -detailed-exitcode exited $TFRC (2 = drift)"
echo TF_CLEAN

# ---------------- SC3 ----------------
TG_ARN=$(aws elbv2 describe-target-groups --region $R --names financial-control-api-tg --query 'TargetGroups[0].TargetGroupArn' --output text) || fail "describe tg"
aws elbv2 describe-target-groups --region $R --names financial-control-api-tg --output json | jq_ "(()=>{const t=j.TargetGroups[0];return (t.HealthCheckPath==='/health'&&t.Matcher.HttpCode==='200'&&t.HealthCheckIntervalSeconds===15&&t.HealthCheckTimeoutSeconds===5&&t.HealthyThresholdCount===2&&t.UnhealthyThresholdCount===3)?'ok':'bad'})()" | grep -qx ok || fail "target group health check settings"
LB_ARN=$(aws elbv2 describe-load-balancers --region $R --query "LoadBalancers[?DNSName=='$ALB'].LoadBalancerArn|[0]" --output text)
aws elbv2 describe-listeners --region $R --load-balancer-arn "$LB_ARN" --output json | jq_ "(j.Listeners.length===1&&j.Listeners[0].Port===80&&j.Listeners[0].Protocol==='HTTP')?'ok':'bad'" | grep -qx ok || fail "ALB must have a single HTTP:80 listener"

if [ "${SKIP_STOP_TASK:-0}" = "1" ]; then
  echo SC3_PARTIAL_SKIPPED_STOP
  echo "SKIPPED disruptive step; PHASE8_VERIFIED not printed" >&2
  exit 0
fi

healthy_count() { aws elbv2 describe-target-health --region $R --target-group-arn "$TG_ARN" --query "length(TargetHealthDescriptions[?TargetHealth.State=='healthy'])" --output text; }
states() { aws elbv2 describe-target-health --region $R --target-group-arn "$TG_ARN" --query 'TargetHealthDescriptions[].TargetHealth.State' --output text | tr '\t' ','; }
[ "$(healthy_count)" = "2" ] || fail "expected 2 healthy targets before the routing test"

TASK=$(aws ecs list-tasks --region $R --cluster "$CLUSTER" --service-name "$SERVICE" --desired-status RUNNING --query 'taskArns[0]' --output text)
case "$TASK" in arn:aws:ecs:*) : ;; *) fail "no running task to stop";; esac
aws ecs stop-task --region $R --cluster "$CLUSTER" --task "$TASK" --reason phase8-sc3-routing-test >/dev/null || fail "stop-task"

OKCOUNT=0; LAST5=""; SAW_REDUCED=0; SEEN=""
for i in $(seq 1 40); do
  CODE=$(node -e "fetch('http://$ALB/health',{signal:AbortSignal.timeout(4000)}).then(r=>console.log(r.status)).catch(()=>console.log(0))")
  [ "$CODE" = "200" ] && OKCOUNT=$((OKCOUNT+1))
  LAST5="$LAST5 $CODE"; LAST5=$(echo $LAST5 | awk '{n=NF; s=""; for(i=(n>4?n-4:1);i<=n;i++) s=s" "$i; print s}')
  ST=$(states)
  case ",$ST," in *,draining,*|*,unhealthy,*|*,initial,*|*,unused,*) SAW_REDUCED=1;; esac
  [ "$(echo "$ST" | tr ',' '\n' | grep -c '^healthy$')" -lt 2 ] && SAW_REDUCED=1
  case " $SEEN " in *" $ST "*) : ;; *) SEEN="$SEEN $ST";; esac
  sleep 3
done

RECOVERED=0
for i in $(seq 1 60); do
  if [ "$(healthy_count)" = "2" ]; then RECOVERED=1; break; fi
  sleep 5
done
echo "SC3 observed: ok_responses=$OKCOUNT/40 last5=[$LAST5 ] target_states_seen=[$SEEN ]"
[ "$OKCOUNT" -ge 36 ] || fail "only $OKCOUNT of 40 requests returned 200"
[ "$(echo $LAST5 | tr ' ' '\n' | grep -c '^200$')" = "5" ] || fail "last 5 responses were not all 200"
[ "$SAW_REDUCED" = "1" ] || fail "stopped target was never observed leaving the healthy set"
[ "$RECOVERED" = "1" ] || fail "service did not return to 2 healthy targets within 300s"
echo SC3_OK
echo PHASE8_VERIFIED
