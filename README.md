# PR Summary Bot

A script that prints a condensed summary of open pull requests for a repository. The summary is written to clipboard as HTML and can be pasted into Slack or any other rich text input which supports HTML rich text.

## Usage

You must have a valid `GITHUB_TOKEN` env variable with `repo` privileges.

```sh
npm start -- owner/repo
```
