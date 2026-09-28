// SPDX-FileCopyrightText: 2026 Daniel Arndt <dan@arndt.ca>
// SPDX-License-Identifier: GPL-2.0-or-later

export const AUTHORED_PR_FRAGMENT = `
fragment AuthoredPRDetails on PullRequest {
  id
  number
  title
  url
  isDraft
  mergeable
  mergeStateStatus
  reviewDecision
  updatedAt
  repository {
    nameWithOwner
    isArchived
    isFork
  }
  author {
    login
  }
  baseRef {
    name
    branchProtectionRule {
      requiredStatusCheckContexts
    }
  }
  reviewRequests(first: 10) {
    nodes {
      requestedReviewer {
        __typename
        ... on User {
          login
        }
      }
    }
  }
  latestReviews(last: 10) {
    nodes {
      author {
        login
      }
      state
    }
  }
  reviewThreads(first: 20) {
    nodes {
      isResolved
    }
  }
  statusCheckRollup {
    state
    contexts(first: 20) {
      nodes {
        __typename
        ... on CheckRun {
          name
          conclusion
          status
        }
        ... on StatusContext {
          context
          state
        }
      }
    }
  }
}
`;

export const SEARCH_PR_FRAGMENT = `
fragment SearchPRDetails on PullRequest {
  id
  number
  title
  url
  isDraft
  mergeable
  updatedAt
  repository {
    nameWithOwner
    isArchived
    isFork
  }
  author {
    login
  }
  reviewRequests(first: 10) {
    nodes {
      requestedReviewer {
        __typename
        ... on User {
          login
        }
      }
    }
  }
  latestReviews(last: 10) {
    nodes {
      author {
        login
      }
      state
    }
  }
}
`;

export const FETCH_ALL_PRS_QUERY = `
${AUTHORED_PR_FRAGMENT}
${SEARCH_PR_FRAGMENT}

query PullRequestsData {
  viewer {
    login
    pullRequests(first: 30, states: [OPEN], orderBy: {field: UPDATED_AT, direction: DESC}) {
      pageInfo {
        hasNextPage
      }
      nodes {
        ...AuthoredPRDetails
      }
    }
  }
  reviewRequested: search(query: "type:pr state:open review-requested:@me", type: ISSUE, first: 30) {
    pageInfo {
      hasNextPage
    }
    nodes {
      ... on PullRequest {
        ...SearchPRDetails
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
  }
}
`;
