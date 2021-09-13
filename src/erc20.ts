import {
  CasperClient,
  CLPublicKey,
  CLAccountHash,
  CLByteArray,
  CLKey,
  CLString,
  CLTypeBuilder,
  CLValue,
  CLValueBuilder,
  CLValueParsers,
  CLMap,
  DeployUtil,
  EventName,
  EventStream,
  Keys,
  RuntimeArgs,
} from "casper-js-sdk";
import { Some, None } from "ts-results";
import { ERC20Events } from "./constants";
import * as utils from "./utils";
import { RecipientType, IPendingDeploy } from "./types";
var blake2 = require('blake2');

class ERC20Client {
  private contractName: string="erc20";
  private contractHash: string;
  private contractPackageHash: string;
  private namedKeys: {
    balances: string;
    metadata: string;
    nonces: string;
    allowances: string;
    ownedTokens: string;
    owners: string;
    paused: string;
  };
  private isListening = false;
  private pendingDeploys: IPendingDeploy[] = [];

  constructor(
    private nodeAddress: string,
    private chainName: string,
    private eventStreamAddress?: string
  ) {}

  public async install(
    keys: Keys.AsymmetricKey,
    //contractName: string,
    paymentAmount: string,
    wasmPath: string
  ) {
    const runtimeArgs = RuntimeArgs.fromMap({
      contract_name: CLValueBuilder.string(this.contractName),
    });

    const deployHash = await installWasmFile({
      chainName: this.chainName,
      paymentAmount,
      nodeAddress: this.nodeAddress,
      keys,
      pathToContract: wasmPath,
      runtimeArgs,
    });

    if (deployHash !== null) {
      return deployHash;
    } else {
      throw Error("Problem with installation");
    }
  }

  public async setContractHash(hash: string) {
    const stateRootHash = await utils.getStateRootHash(this.nodeAddress);
    const contractData = await utils.getContractData(
      this.nodeAddress,
      stateRootHash,
      hash
    );

    const { contractPackageHash, namedKeys } = contractData.Contract!;
    this.contractHash = hash;
    this.contractPackageHash = contractPackageHash.replace(
      "contract-package-wasm",
      ""
    );
    const LIST_OF_NAMED_KEYS = [
      'balances',
      'allowances',
      `${this.contractName}_package_hash`,
      `${this.contractName}_package_hash_wrapped`,
      `${this.contractName}_contract_hash`,
      `${this.contractName}_contract_hash_wrapped`,
      `${this.contractName}_package_access_token`,
    ];
    // @ts-ignore
    this.namedKeys = namedKeys.reduce((acc, val) => {
      if (LIST_OF_NAMED_KEYS.includes(val.name)) {
        return { ...acc, [utils.camelCased(val.name)]: val.key };
      }
      return acc;
    }, {});
  }

  public async name() {
    const result = await contractSimpleGetter(
      this.nodeAddress,
      this.contractHash,
      ["name"]
    );
    return result.value();
  }

  public async symbol() {
    const result = await contractSimpleGetter(
      this.nodeAddress,
      this.contractHash,
      ["symbol"]
    );
    return result.value();
  }

  public async decimal() {
    const result = await contractSimpleGetter(
      this.nodeAddress,
      this.contractHash,
      ["decimal"]
    );
    return result.value();
  }

  public async balanceOf(account: CLPublicKey) {
    const accountHash = Buffer.from(account.toAccountHash()).toString("hex");
    console.log("Account hash , ",accountHash);
    const result = await utils.contractDictionaryGetter(
      this.nodeAddress,
      accountHash,
      this.namedKeys.balances
    );
    const maybeValue = result.value().unwrap();
    return maybeValue.value().toString();
  }

  public async allowance(owner: CLPublicKey, spender: CLPublicKey) {
    const ownerAccountHash = Buffer.from(owner.toAccountHash()).toString("hex");
    const spenderAccountHash = Buffer.from(spender.toAccountHash()).toString("hex");

    var ownerAccountHashbytes = [];
    for(var i = 0; i < ownerAccountHash.length; i++) {
        var char = ownerAccountHash.charCodeAt(i);
        ownerAccountHashbytes.push(char >>> 8);
        ownerAccountHashbytes.push(char & 0xFF);
    }

    var spenderAccountHashbytes = [];
    for(var i = 0; i < spenderAccountHash.length; i++) {
        var char = spenderAccountHash.charCodeAt(i);
        spenderAccountHashbytes.push(char >>> 8);
        spenderAccountHashbytes.push(char & 0xFF);
    }

    const finalbytes = ownerAccountHashbytes.concat(spenderAccountHashbytes);

    var h = blake2.createHash('blake2b');
    h.update(Buffer.from(finalbytes));
    console.log(h.digest("hex"));

    
    const result = await utils.contractDictionaryGetter(
      this.nodeAddress,
      h.toString("hex"),
      this.namedKeys.allowances
    );
    const maybeValue = result.value().unwrap();
    return maybeValue.value().toString();

  }

  public async totalSupply() {
    const result = await contractSimpleGetter(
      this.nodeAddress,
      this.contractHash,
      ["total_supply"]
    );
    return result.value();
  }

  public async approve(
    keys: Keys.AsymmetricKey,
    spender: RecipientType,
    amount: string,
    paymentAmount: string
    ) {
    
      const runtimeArgs = RuntimeArgs.fromMap({
        spender: utils.createRecipientAddress(spender),
        amount: CLValueBuilder.u256(amount)
      });

      const deployHash = await contractCall({
        chainName: this.chainName,
        contractHash: this.contractHash,
        entryPoint: "approve",
        keys,
        nodeAddress: this.nodeAddress,
        paymentAmount,
        runtimeArgs,
      });
  
      if (deployHash !== null) {
        this.addPendingDeploy(ERC20Events.Approve, deployHash);
        return deployHash;
      } else {
        throw Error("Invalid Deploy");
      }
  }
  public async transfer(
    keys: Keys.AsymmetricKey,
    recipient: RecipientType,
    amount: string,
    paymentAmount: string
    ) {
    
      const runtimeArgs = RuntimeArgs.fromMap({
        recipient: utils.createRecipientAddress(recipient),
        amount: CLValueBuilder.u256(amount)
      });


      const deployHash = await contractCall({
        chainName: this.chainName,
        contractHash: this.contractHash,
        entryPoint: "transfer",
        keys,
        nodeAddress: this.nodeAddress,
        paymentAmount,
        runtimeArgs,
      });
  
      if (deployHash !== null) {
        this.addPendingDeploy(ERC20Events.Transfer, deployHash);
        return deployHash;
      } else {
        throw Error("Invalid Deploy");
      }
  }
  public async transferFrom(
    keys: Keys.AsymmetricKey,
    owner: RecipientType,
    recipient: RecipientType,
    amount: string,
    paymentAmount: string
    ) {
    
      const runtimeArgs = RuntimeArgs.fromMap({
        owner: utils.createRecipientAddress(owner),
        recipient: utils.createRecipientAddress(recipient),
        amount: CLValueBuilder.u256(amount)
      });


      const deployHash = await contractCall({
        chainName: this.chainName,
        contractHash: this.contractHash,
        entryPoint: "transfer_from",
        keys,
        nodeAddress: this.nodeAddress,
        paymentAmount,
        runtimeArgs,
      });
  
      if (deployHash !== null) {
        this.addPendingDeploy(ERC20Events.Transfer, deployHash);
        return deployHash;
      } else {
        throw Error("Invalid Deploy");
      }
  }
  public async mint(
    keys: Keys.AsymmetricKey,
    to: RecipientType,
    amount: string,
    paymentAmount: string
    ) {
    
      const runtimeArgs = RuntimeArgs.fromMap({
        to: utils.createRecipientAddress(to),
        amount: CLValueBuilder.u256(amount)
      });

      const deployHash = await contractCall({
        chainName: this.chainName,
        contractHash: this.contractHash,
        entryPoint: "mint",
        keys,
        nodeAddress: this.nodeAddress,
        paymentAmount,
        runtimeArgs,
      });
  
      if (deployHash !== null) {
        this.addPendingDeploy(ERC20Events.Mint, deployHash);
        return deployHash;
      } else {
        throw Error("Invalid Deploy");
      }
  }
  
  public onEvent(
    eventNames: ERC20Events[],
    callback: (
      eventName: ERC20Events,
      deployStatus: {
        deployHash: string;
        success: boolean;
        error: string | null;
      },
      result: any | null
    ) => void
  ): any {
    if (!this.eventStreamAddress) {
      throw Error("Please set eventStreamAddress before!");
    }
    if (this.isListening) {
      throw Error(
        "Only one event listener can be create at a time. Remove the previous one and start new."
      );
    }
    const es = new EventStream(this.eventStreamAddress);
    this.isListening = true;

    es.subscribe(EventName.DeployProcessed, (value: any) => {
      const deployHash = value.body.DeployProcessed.deploy_hash;

      const pendingDeploy = this.pendingDeploys.find(
        (pending) => pending.deployHash === deployHash
      );

      if (!pendingDeploy) {
        return;
      }

      if (
        !value.body.DeployProcessed.execution_result.Success &&
        value.body.DeployProcessed.execution_result.Failure
      ) {
        callback(
          pendingDeploy.deployType,
          {
            deployHash,
            error:
              value.body.DeployProcessed.execution_result.Failure.error_message,
            success: false,
          },
          null
        );
      } else {
        const { transforms } =
          value.body.DeployProcessed.execution_result.Success.effect;

        const ERC20Events = transforms.reduce((acc: any, val: any) => {
          if (
            val.transform.hasOwnProperty("WriteCLValue") &&
            typeof val.transform.WriteCLValue.parsed === "object" &&
            val.transform.WriteCLValue.parsed !== null
          ) {
            const maybeCLValue = CLValueParsers.fromJSON(
              val.transform.WriteCLValue
            );
            const clValue = maybeCLValue.unwrap();
            if (clValue && clValue instanceof CLMap) {
              const hash = clValue.get(
                CLValueBuilder.string("contract_package_hash")
              );
              const event = clValue.get(CLValueBuilder.string("event_type"));
              if (
                hash &&
                hash.value() === this.contractPackageHash &&
                event &&
                eventNames.includes(event.value())
              ) {
                acc = [...acc, { name: event.value(), clValue }];
              }
            }
          }
          return acc;
        }, []);

        ERC20Events.forEach((d: any) =>
          callback(
            d.name,
            { deployHash, error: null, success: true },
            d.clValue
          )
        );
      }

      this.pendingDeploys = this.pendingDeploys.filter(
        (pending) => pending.deployHash !== deployHash
      );
    });
    es.start();

    return {
      stopListening: () => {
        es.unsubscribe(EventName.DeployProcessed);
        es.stop();
        this.isListening = false;
        this.pendingDeploys = [];
      },
    };
  }

  private addPendingDeploy(deployType: ERC20Events, deployHash: string) {
    this.pendingDeploys = [...this.pendingDeploys, { deployHash, deployType }];
  }
}

interface IInstallParams {
  nodeAddress: string;
  keys: Keys.AsymmetricKey;
  chainName: string;
  pathToContract: string;
  runtimeArgs: RuntimeArgs;
  paymentAmount: string;
}

const installWasmFile = async ({
  nodeAddress,
  keys,
  chainName,
  pathToContract,
  runtimeArgs,
  paymentAmount,
}: IInstallParams): Promise<string> => {
  const client = new CasperClient(nodeAddress);

  // Set contract installation deploy (unsigned).
  let deploy = DeployUtil.makeDeploy(
    new DeployUtil.DeployParams(
      CLPublicKey.fromHex(keys.publicKey.toHex()),
      chainName
    ),
    DeployUtil.ExecutableDeployItem.newModuleBytes(
      utils.getBinary(pathToContract),
      runtimeArgs
    ),
    DeployUtil.standardPayment(paymentAmount)
  );

  // Sign deploy.
  deploy = client.signDeploy(deploy, keys);

  // Dispatch deploy to node.
  return await client.putDeploy(deploy);
};

interface IContractCallParams {
  nodeAddress: string;
  keys: Keys.AsymmetricKey;
  chainName: string;
  entryPoint: string;
  runtimeArgs: RuntimeArgs;
  paymentAmount: string;
  contractHash: string;
}

const contractCall = async ({
  nodeAddress,
  keys,
  chainName,
  contractHash,
  entryPoint,
  runtimeArgs,
  paymentAmount,
}: IContractCallParams) => {
  const client = new CasperClient(nodeAddress);
  const contractHashAsByteArray = utils.contractHashToByteArray(contractHash);

  let deploy = DeployUtil.makeDeploy(
    new DeployUtil.DeployParams(keys.publicKey, chainName),
    DeployUtil.ExecutableDeployItem.newStoredContractByHash(
      contractHashAsByteArray,
      entryPoint,
      runtimeArgs
    ),
    DeployUtil.standardPayment(paymentAmount)
  );

  // Sign deploy.
  deploy = client.signDeploy(deploy, keys);

  // Dispatch deploy to node.
  const deployHash = await client.putDeploy(deploy);

  return deployHash;
};

const contractSimpleGetter = async (
  nodeAddress: string,
  contractHash: string,
  key: string[]
) => {
  const stateRootHash = await utils.getStateRootHash(nodeAddress);
  const clValue = await utils.getContractData(
    nodeAddress,
    stateRootHash,
    contractHash,
    key
  );

  if (clValue && clValue.CLValue instanceof CLValue) {
    return clValue.CLValue!;
  } else {
    throw Error("Invalid stored value");
  }
};

const toCLMap = (map: Map<string, string>) => {
  const clMap = CLValueBuilder.map([
    CLTypeBuilder.string(),
    CLTypeBuilder.string(),
  ]);
  for (const [key, value] of Array.from(map.entries())) {
    clMap.set(CLValueBuilder.string(key), CLValueBuilder.string(value));
  }
  return clMap;
};

const fromCLMap = (map: Map<CLString, CLString>) => {
  const jsMap = new Map();
  for (const [key, value] of Array.from(map.entries())) {
    jsMap.set(key.value(), value.value());
  }
  return jsMap;
};

export default ERC20Client;
