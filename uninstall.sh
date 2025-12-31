#! env bash
# remove example ocp console plugin
source setup_env.sh || exit "Missing setup_env.sh"

# remove ocp-console-plugin from console operator
oc get console.operator.openshift.io cluster -o json | \
  jq 'del(.spec.plugins[] | select(. == "$APP_NAME"))' | \
  oc apply -f -

oc delete -k manifests