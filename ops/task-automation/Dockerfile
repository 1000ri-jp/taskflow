FROM node:22-alpine
WORKDIR /job
COPY scripts/run-task-automation-job.mjs ./run-task-automation-job.mjs
USER node
CMD ["node", "run-task-automation-job.mjs"]
