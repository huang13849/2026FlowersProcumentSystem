// Jenkinsfile for shop-management-service
// Build on office2-wsl (xspt05 100.113.60.71) via ubuntu-master (100.96.54.109) as jumpbox.
// Path: k3s-build-agent pod -> ssh ubuntu-master -> ssh xspt05 -> git clone + docker build + push -> kubectl rollout
pipeline {
  agent any

  environment {
    REGISTRY   = "100.76.15.64:5001"
    IMAGE_BASE = "${REGISTRY}/supply-chain/shop-management-service"
    SERVICE    = "shop-management-service"
    NAMESPACE  = "supply-chain"
    NODE_PORT  = "31004"

    // Jumpbox (k3s master where jenkins-agent key authorized)
    JUMP_USER = "huangfra-ubun-master"
    JUMP_HOST = "100.96.54.109"
    // Build host (office2-wsl = xspt05 WSL2)
    BUILD_USER = "dell"
    BUILD_HOST = "100.113.60.71"
    BUILD_WORKDIR = "/home/dell/shop-management-service"

    GITEA_URL  = "http://100.76.15.64:13000/admin/supply-chain-platform.git"
    GIT_BRANCH = "main"
  }

  stages {
    stage('Checkout') {
      steps {
        checkout scm
        sh 'git rev-parse --short HEAD > .git/HEAD_SHA'
      }
    }

    stage('Build on office2-wsl') {
      steps {
        sh '''
          set -euo pipefail
          SHA=$(cat .git/HEAD_SHA)
          TAG="${SERVICE}-jenkins-$(date +%Y%m%d%H%M%S)-${SHA}"
          IMG="${IMAGE_BASE}:${TAG}"

          echo "[1/5] jumpbox ${JUMP_USER}@${JUMP_HOST} -> build ${BUILD_USER}@${BUILD_HOST} (office2-wsl xspt05)"
          ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null ${JUMP_USER}@${JUMP_HOST} "bash -s" <<REMOTE
            set -euo pipefail
            ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null ${BUILD_USER}@${BUILD_HOST} "bash -s" <<BUILDREMOTE
              set -euo pipefail
              export PATH="/usr/local/bin:/usr/bin:/bin:\\$PATH"
              mkdir -p ${BUILD_WORKDIR}
              cd ${BUILD_WORKDIR}
              if [ ! -d .git ]; then
                git clone ${GITEA_URL} .
              fi
              git fetch origin
              git reset --hard origin/${GIT_BRANCH}
              git clean -fd
              cd shop-service
              docker build --platform linux/amd64 -t ${IMG} .
              docker push ${IMG}
              echo ${TAG} > /tmp/last_tag.txt
BUILDREMOTE
REMOTE

          LAST_TAG=\\$(ssh -o StrictHostKeyChecking=no ${JUMP_USER}@${JUMP_HOST} "ssh -o StrictHostKeyChecking=no ${BUILD_USER}@${BUILD_HOST} 'cat /tmp/last_tag.txt'")
          IMG="${IMAGE_BASE}:${LAST_TAG}"
          echo "[2/5] deploy ${IMG} to k3s"
          kubectl -n ${NAMESPACE} set image deployment/${SERVICE} ${SERVICE}="${IMG}"
          kubectl -n ${NAMESPACE} rollout status deployment/${SERVICE} --timeout=180s
          echo "TAG_FILE: ${LAST_TAG}" | tee /tmp/last_tag.txt
        '''
      }
    }

    stage('Verify endpoints') {
      steps {
        sh '''
          set -euo pipefail
          for u in \\
            http://127.0.0.1:${NODE_PORT}/ \\
            http://127.0.0.1:${NODE_PORT}/api/health \\
            http://127.0.0.1:${NODE_PORT}/api/shops \\
            "http://127.0.0.1:${NODE_PORT}/api/shops?platform=huaxiang"; do
            code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 "$u" || echo ERR)
            echo "$code $u"
            [ "$code" = "200" ] || exit 20
          done
        '''
      }
    }

    stage('Verify deployed image') {
      steps {
        sh 'kubectl -n ${NAMESPACE} get deploy ${SERVICE} -o jsonpath=\'{.spec.template.spec.containers[0].image}{\\"\\\\n\\"}\''
      }
    }
  }

  post {
    success {
      echo "shop-management-service deployed OK from office2-wsl build"
    }
    failure {
      echo "shop-management-service build/deploy failed"
    }
  }
}
