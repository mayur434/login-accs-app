async function main () {
  const extensionId = 'customer-module'
  return {
    statusCode: 200,
    body: {
      registration: {
        menuItems: [
          {
            id: `${extensionId}::apps`,
            title: 'Customer Module',
            isSection: true,
            sortOrder: 100
          },
          {
            id: `${extensionId}::admin`,
            title: 'Login Module',
            parent: `${extensionId}::apps`,
            sortOrder: 1
          }
        ],
        page: {
          title: 'Login Module'
        }
      }
    }
  }
}

exports.main = main
