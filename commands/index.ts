import { BaseCommand, flags, listDirectoryFiles } from '@adonisjs/core/build/standalone'
import Application from '@ioc:Adonis/Core/Application'
import { createProxyAgent, shouldProxy } from 'App/Helpers/Proxy'
import { defaultCa, defaultEmail, defaultEnv } from 'Config/app'
import Acme from "handyacme"

/*
|--------------------------------------------------------------------------
| Exporting an array of commands
|--------------------------------------------------------------------------
|
| Instead of manually exporting each file from this directory, we use the
| helper `listDirectoryFiles` to recursively collect and export an array
| of filenames.
|
| Couple of things to note:
|
| 1. The file path must be relative from the project root and not this directory.
| 2. We must ignore this file to avoid getting into an infinite loop
|
*/
export default listDirectoryFiles(__dirname, Application.appRoot, ['./commands/index'])

export type AvailableCaAlias = "letsencrypt" | "le" | "zerossl" | "zs" | "buypass" | "bp"
export type AvailableCa = "LetsEncrypt" | "ZeroSSL" | "BuyPass"
export type AvailableEnv = "staging" | "production"

export function isCaAlias(str: string): str is AvailableCaAlias {
  return [
    "letsencrypt", "le", "zerossl", "zs", "buypass", "bp"
  ].includes(str)
}

export function isCa(str: string): str is AvailableCa {
  return [
    "LetsEncrypt", "ZeroSSL", "BuyPass"
  ].includes(str)
}

export const getAuthorityName = (alias: AvailableCaAlias | AvailableCa): AvailableCa => {
  if (isCa(alias)) {
    return alias
  }
  const authorities: Record<AvailableCaAlias, AvailableCa> = {
    letsencrypt: "LetsEncrypt",
    le: "LetsEncrypt",
    zerossl: "ZeroSSL",
    zs: "ZeroSSL",
    buypass: "BuyPass",
    bp: "BuyPass"
  }
  return authorities[alias]
}
/**
 * Note
 * MUST use function to return a class
 * To make sure the decorator not pollute class
 * Or flags/args defined in each commands will appear at this class!!
 * 
 * @returns OrderBaseCommand
 */
export function base() {
  class OrderBaseCommand extends BaseCommand {
    @flags.string({
      description: "options: letsencrypt | le | zerossl | zs | buypass | bp" + (defaultCa ? `, default ${defaultCa}` : '')
    })
    public ca: AvailableCaAlias | AvailableCa
  
    @flags.string({
      description: "options: staging | production" + (defaultEnv ? `, default ${defaultEnv}` : ''),
    })
    public env: AvailableEnv
  
    @flags.string({ description: "order's account email"})
    public email: string
  
    get authorityAlias() {
      return this.ca || defaultCa
    }
  
    get authorityName() {
      return getAuthorityName(this.authorityAlias)
    }
  
    get authorityEnv() {
      return this.env || defaultEnv
    }
  
    get authorityEmail() {
      return this.email || defaultEmail
    }
  
    async findAccount() {
      const { default: Account } = await import('App/Models/Account')
      return Account.findUnique({
        email: this.authorityEmail,
        ca: this.authorityName,
        type: this.authorityEnv
      })
    }
  
    async findOrder(domainName: string) {
      const { default: CertOrder } = await import("App/Models/CertOrder")
      return CertOrder.findExistingOne({
        ca: this.authorityName,
        type: this.authorityEnv,
        email: this.authorityEmail,
        name: domainName
      })
    }

    async findCert(domainName: string) {
      const { default: Cert } = await import('App/Models/Cert')
      return Cert.query()
        .where('ca', this.authorityName)
        .where('type', this.authorityEnv)
        .where('email', this.authorityEmail)
        .where('name', domainName)
        .first()
    }

    async findDnsCred(dnsCredName: string) {
      const { default: DnsCred } = await import("App/Models/DnsCred")
      return DnsCred.findBy('name', dnsCredName)
    }
    
    async createAcmeClient() {
      const client = await Acme.create(this.authorityName, "none")

      if (shouldProxy(client.productionDirectoryUrl)) {
        client.request.agent = createProxyAgent()
      }
      if (this.authorityEnv === "staging") {
        await client.setStaging()
      } else if (this.authorityEnv === "production") {
        await client.setProduction()
      }
            
      const user = await this.findAccount()
      if (user) {
        await client.importAccount({
          email: user.email,
          accountUrl: user.accountUrl,
          jwk: user.jwk
        })
      }
      return client
    }
  
    async createAccount() {
  
      const acmeClient = await this.createAcmeClient()
      await acmeClient.createAccount(this.authorityEmail)
      
      const accountInfo = {
        jwk: await acmeClient.account.exportPrivateJwk(),
        email: acmeClient.account.email,
        accountUrl: acmeClient.account.accountUrl,
        ca: this.authorityName,
        type: this.authorityEnv
      }
      const { default: Account } = await import("App/Models/Account")
      return await Account.create(accountInfo)
    }
    
    showConfirmTips(tips: string) {
      this.logger.action('').failed(`Use ${this.colors.red('--yes')} to continue`, tips)
    }
  
    confirmed() {
      return !!this['yes']
    }
  }
  return OrderBaseCommand
}