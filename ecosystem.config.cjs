module.exports = {
    apps: [
        {
            name: "daily-worker",
            script: "./worker.js",

            // Logging
            out_file: "./logs/worker-out.log",
            err_file: "./logs/worker-err.log",
            log_date_format: "YYYY-MM-DD HH:mm:ss",

            // Stability
            autorestart: false,        // disable auto-restart for normal completion
            max_memory_restart: "1G",
            watch: false,
            cron_restart: "0 0 * * *", // run at midnight every day

            env: {
                NODE_ENV: "production"
            }
        }
    ]
}