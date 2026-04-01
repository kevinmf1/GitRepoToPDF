import fs from "fs";

//@ts-ignore
import type chalkType from "chalk";
//@ts-ignore
import type inquirerType from "inquirer";

let chalk: typeof chalkType;
let inquirer: typeof inquirerType;

type QuestionType = {
  type?: string;
  name: string;
  message: string;
  validate?: (value: string) => boolean | string;
  filter?: (value: string) => boolean | string | string[];
  choices?: string[];
  default?: string | string[];
  when?: (answers: any) => boolean;
};

export async function configQuestions(
  main: Function,
  chalk: typeof chalkType,
  inquirer: typeof inquirerType,
) {
  const questions: QuestionType[] = [
    {
      type: "list",
      name: "localRepo",
      message: "Do you want to use a local repository?",
      choices: ["No", "Yes"],
      filter: function (val: string) {
        return val.toLowerCase() === "yes";
      },
    },
    {
      name: "localRepoPath",
      message: "Please provide the full path to the local repository:",
      when(answers: { localRepo: boolean }) {
        return answers.localRepo;
      },
      validate: function (value: string) {
        if (fs.existsSync(value)) {
          return true;
        } else {
          return "Please enter a valid directory path.";
        }
      },
    },
    {
      name: "repoUrl",
      message: "Please provide a GitHub repository URL:",
      when(answers: { localRepo: boolean }) {
        return !answers.localRepo;
      },
      validate: function (value: string) {
        var pass = value.match(
          /^https:\/\/github.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/,
        );
        if (pass) {
          return true;
        }
        return "Please enter a valid GitHub repository URL.";
      },
    },
    {
      type: "checkbox",
      name: "features",
      message: "Select the features you want to include:",
      choices: [
        "Add line numbers",
        "Add highlighting",
        "Add page numbers",
        "Remove comments",
        "Remove empty lines",
        "Format Markdown files",
        "One PDF per file",
      ],
    },
    {
      name: "outputFileName",
      message: "Please provide an output file name:",
      default: "output.pdf",
      when(answers: { features: string[] }) {
        return !answers.features.includes("One PDF per file");
      },
    },
    {
      name: "outputFolderName",
      message: "Please provide an output folder name:",
      default: "./output",
      when(answers: { features: string[] }) {
        return answers.features.includes("One PDF per file");
      },
    },
    {
      type: "list",
      name: "keepRepo",
      message: "Do you want to keep the cloned repository?",
      choices: ["No", "Yes"],
      when(answers: { localRepo: boolean }) {
        return !answers.localRepo;
      },
      filter: function (val: string) {
        return val.toLowerCase() === "yes";
      },
    },
  ];

  console.log(
    chalk.cyanBright(`
  ██████╗ ███████╗██████╗  ██████╗         ██████╗         ██████╗ ██████╗ ███████╗
  ██╔══██╗██╔════╝██╔══██╗██╔═══██╗        ╚════██╗        ██╔══██╗██╔══██╗██╔════╝
  ██████╔╝█████╗  ██████╔╝██║   ██║         █████╔╝        ██████╔╝██║  ██║█████╗
  ██╔══██╗██╔══╝  ██╔═══╝ ██║   ██║        ██╔═══╝         ██╔═══╝ ██║  ██║██╔══╝
  ██║  ██║███████╗██║     ╚██████╔╝        ███████╗        ██║     ██████╔╝██║
  ╚═╝  ╚═╝╚══════╝╚═╝      ╚═════╝         ╚══════╝        ╚═╝     ╚═════╝ ╚═╝

  Welcome to Repo-to-PDF! Let's get started...
  `),
  );

  const answers = await inquirer.prompt(questions);
  console.log(chalk.cyanBright("\nProcessing your request...\n"));

  const {
    localRepo,
    localRepoPath,
    repoUrl,
    features,
    outputFileName,
    outputFolderName,
    keepRepo,
  } = answers;

  main(
    localRepo ? localRepoPath : repoUrl,
    localRepo,
    features.includes("Add line numbers"),
    features.includes("Add highlighting"),
    features.includes("Add page numbers"),
    features.includes("Remove comments"),
    features.includes("Remove empty lines"),
    features.includes("Format Markdown files"),
    features.includes("One PDF per file"),
    outputFileName,
    outputFolderName,
    keepRepo,
  );
}
