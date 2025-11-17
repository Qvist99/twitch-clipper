module.exports = {
    apps: [
        {
            name: "daily-worker",
            script: "./worker.js",

            //logging
            out_file: "./logs/worker-out.log",
            err_file: "./logs/worker-err.log",
            log_date_format: "YYYY-MM-DD HH:mm:ss",

            //stability
            autorestart: true,
            max_memory_restart: "1G",
            watch: false,


            env: {
                NODE_ENV: "production"
            }


        }
    ]
}