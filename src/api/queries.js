// SPDX-FileCopyrightText: 2026 Daniel Arndt <dan@arndt.ca>
// SPDX-License-Identifier: GPL-2.0-or-later

export const PR_FRAGMENT = `
fragment PRDetails on PullRequest {
  id
  number
  title
  url
  isDraft
  mergeable
  reviewDecision
  updatedAt
  createdAt
  repository {
    nameWithOwner
    isArchived
    isFork
  }
  author {
    login
    avatarUrl
  }
  reviewRequests(first: 20) {
    nodes {
      requestedReviewer {
        ... on User {
          login
        }
      }
    }
  }
  latestReviews(last: 20) {
    nodes {
      author {
        login
      }
      state
      createdAt
    }
  }
  reviewThreads(first: 50) {
    nodes {
      isResolved
    }
  }
  commits(last: 1) {
    nodes {
      commit {
        statusCheckRollup {
          state
          contexts(first: 50) {
            nodes {
              __typename
              ... on CheckRun {
                name
                conclusion
                status
                isRequired
              }
              ... on StatusContext {
                context
                state
                isRequired
              }
            }
          }
        }
      }
    }
  }
}
`;

export const FETCH_ALL_PRS_QUERY = `
${PR_FRAGMENT}

query PullRequestsData {
  viewer {
    login
    avatarUrl
    pullRequests(first: 50, states: [OPEN], orderBy: {field: UPDATED_AT, direction: DESC}) {
      nodes {
        ...PRDetails
      }
    }
  }
  reviewRequested: search(query: "type:pr state:open review-requested:@me", type: ISSUE, first: 30) {
    nodes {
      ... on PullRequest {
        ...PRDetails
      }
    }
  }
  reviewedByMe: search(query: "type:pr state:open reviewed-by:@me -author:@me", type: ISSUE, first: 30) {
    nodes {
      ... on PullRequest {
        ...PRDetails
      }
    }
  }
}
`;

export const VERIFY_USER_QUERY = `
query VerifyUser {
  viewer {
    login
    name
    avatarUrl
  }
}
`;
