import { program } from "@commander-js/extra-typings";
import main from "./main.js";

program
  .argument("<tracks...>")
  .option("--erase")
  .option("--gapless")
  .action((tracks, options) => {
    main(tracks, options)
      .then(() => process.exit())
      .catch((err) => {
        console.error(err);
        process.exit(1);
      });
  })
  .parse();
