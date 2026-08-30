/**
 * NFT ABIs, extracted from the compiled artifacts rather than transcribed.
 *
 * COTI privacy types over the wire, same as elsewhere here:
 *   ctString  -> (uint256[3]) chunked string ciphertext, sealed to one key
 *   itString  -> (ctString value, bytes signature) signed input
 *
 * `tokenURI` on a drop and `secretOf` on an edition both return ctString:
 * ciphertext, not a URL. Decrypting is the client's job, and only the holder's
 * key will do it.
 */

export const devoxNFTDropAbi = [
 {
  "anonymous": false,
  "inputs": [
   {
    "indexed": true,
    "internalType": "address",
    "name": "to",
    "type": "address"
   },
   {
    "indexed": true,
    "internalType": "uint256",
    "name": "tokenId",
    "type": "uint256"
   },
   {
    "indexed": false,
    "internalType": "uint256",
    "name": "paid",
    "type": "uint256"
   }
  ],
  "name": "Minted",
  "type": "event"
 },
 {
  "anonymous": false,
  "inputs": [
   {
    "indexed": true,
    "internalType": "address",
    "name": "from",
    "type": "address"
   },
   {
    "indexed": true,
    "internalType": "address",
    "name": "to",
    "type": "address"
   },
   {
    "indexed": true,
    "internalType": "uint256",
    "name": "tokenId",
    "type": "uint256"
   }
  ],
  "name": "Transfer",
  "type": "event"
 },
 {
  "inputs": [
   {
    "internalType": "address",
    "name": "",
    "type": "address"
   }
  ],
  "name": "allowlisted",
  "outputs": [
   {
    "internalType": "bool",
    "name": "",
    "type": "bool"
   }
  ],
  "stateMutability": "view",
  "type": "function"
 },
 {
  "inputs": [
   {
    "internalType": "address",
    "name": "to",
    "type": "address"
   },
   {
    "internalType": "uint256",
    "name": "tokenId",
    "type": "uint256"
   }
  ],
  "name": "approve",
  "outputs": [],
  "stateMutability": "nonpayable",
  "type": "function"
 },
 {
  "inputs": [
   {
    "internalType": "address",
    "name": "owner",
    "type": "address"
   }
  ],
  "name": "balanceOf",
  "outputs": [
   {
    "internalType": "uint256",
    "name": "",
    "type": "uint256"
   }
  ],
  "stateMutability": "view",
  "type": "function"
 },
 {
  "inputs": [
   {
    "internalType": "uint256",
    "name": "tokenId",
    "type": "uint256"
   }
  ],
  "name": "getApproved",
  "outputs": [
   {
    "internalType": "address",
    "name": "",
    "type": "address"
   }
  ],
  "stateMutability": "view",
  "type": "function"
 },
 {
  "inputs": [
   {
    "internalType": "address",
    "name": "owner",
    "type": "address"
   },
   {
    "internalType": "address",
    "name": "operator",
    "type": "address"
   }
  ],
  "name": "isApprovedForAll",
  "outputs": [
   {
    "internalType": "bool",
    "name": "",
    "type": "bool"
   }
  ],
  "stateMutability": "view",
  "type": "function"
 },
 {
  "inputs": [],
  "name": "maxPerWallet",
  "outputs": [
   {
    "internalType": "uint256",
    "name": "",
    "type": "uint256"
   }
  ],
  "stateMutability": "view",
  "type": "function"
 },
 {
  "inputs": [],
  "name": "maxSupply",
  "outputs": [
   {
    "internalType": "uint256",
    "name": "",
    "type": "uint256"
   }
  ],
  "stateMutability": "view",
  "type": "function"
 },
 {
  "inputs": [
   {
    "internalType": "uint256",
    "name": "quantity",
    "type": "uint256"
   }
  ],
  "name": "mint",
  "outputs": [],
  "stateMutability": "payable",
  "type": "function"
 },
 {
  "inputs": [],
  "name": "mintPrice",
  "outputs": [
   {
    "internalType": "uint256",
    "name": "",
    "type": "uint256"
   }
  ],
  "stateMutability": "view",
  "type": "function"
 },
 {
  "inputs": [
   {
    "internalType": "address",
    "name": "who",
    "type": "address"
   }
  ],
  "name": "mintState",
  "outputs": [
   {
    "internalType": "bool",
    "name": "open",
    "type": "bool"
   },
   {
    "internalType": "string",
    "name": "reason",
    "type": "string"
   }
  ],
  "stateMutability": "view",
  "type": "function"
 },
 {
  "inputs": [
   {
    "internalType": "address",
    "name": "",
    "type": "address"
   }
  ],
  "name": "mintedBy",
  "outputs": [
   {
    "internalType": "uint256",
    "name": "",
    "type": "uint256"
   }
  ],
  "stateMutability": "view",
  "type": "function"
 },
 {
  "inputs": [],
  "name": "name",
  "outputs": [
   {
    "internalType": "string",
    "name": "",
    "type": "string"
   }
  ],
  "stateMutability": "view",
  "type": "function"
 },
 {
  "inputs": [],
  "name": "owner",
  "outputs": [
   {
    "internalType": "address",
    "name": "",
    "type": "address"
   }
  ],
  "stateMutability": "view",
  "type": "function"
 },
 {
  "inputs": [
   {
    "internalType": "uint256",
    "name": "tokenId",
    "type": "uint256"
   }
  ],
  "name": "ownerOf",
  "outputs": [
   {
    "internalType": "address",
    "name": "",
    "type": "address"
   }
  ],
  "stateMutability": "view",
  "type": "function"
 },
 {
  "inputs": [],
  "name": "payToken",
  "outputs": [
   {
    "internalType": "address",
    "name": "",
    "type": "address"
   }
  ],
  "stateMutability": "view",
  "type": "function"
 },
 {
  "inputs": [],
  "name": "presaleStart",
  "outputs": [
   {
    "internalType": "uint64",
    "name": "",
    "type": "uint64"
   }
  ],
  "stateMutability": "view",
  "type": "function"
 },
 {
  "inputs": [],
  "name": "previewURI",
  "outputs": [
   {
    "internalType": "string",
    "name": "",
    "type": "string"
   }
  ],
  "stateMutability": "view",
  "type": "function"
 },
 {
  "inputs": [],
  "name": "proceeds",
  "outputs": [
   {
    "internalType": "address",
    "name": "",
    "type": "address"
   }
  ],
  "stateMutability": "view",
  "type": "function"
 },
 {
  "inputs": [],
  "name": "publicStart",
  "outputs": [
   {
    "internalType": "uint64",
    "name": "",
    "type": "uint64"
   }
  ],
  "stateMutability": "view",
  "type": "function"
 },
 {
  "inputs": [],
  "name": "secretSet",
  "outputs": [
   {
    "internalType": "bool",
    "name": "",
    "type": "bool"
   }
  ],
  "stateMutability": "view",
  "type": "function"
 },
 {
  "inputs": [
   {
    "internalType": "address[]",
    "name": "who",
    "type": "address[]"
   },
   {
    "internalType": "bool",
    "name": "allowed",
    "type": "bool"
   }
  ],
  "name": "setAllowlist",
  "outputs": [],
  "stateMutability": "nonpayable",
  "type": "function"
 },
 {
  "inputs": [
   {
    "internalType": "address",
    "name": "operator",
    "type": "address"
   },
   {
    "internalType": "bool",
    "name": "approved",
    "type": "bool"
   }
  ],
  "name": "setApprovalForAll",
  "outputs": [],
  "stateMutability": "nonpayable",
  "type": "function"
 },
 {
  "inputs": [
   {
    "internalType": "uint64",
    "name": "presaleStart_",
    "type": "uint64"
   },
   {
    "internalType": "uint64",
    "name": "publicStart_",
    "type": "uint64"
   }
  ],
  "name": "setPhases",
  "outputs": [],
  "stateMutability": "nonpayable",
  "type": "function"
 },
 {
  "inputs": [
   {
    "internalType": "string",
    "name": "uri",
    "type": "string"
   }
  ],
  "name": "setPreviewURI",
  "outputs": [],
  "stateMutability": "nonpayable",
  "type": "function"
 },
 {
  "inputs": [
   {
    "internalType": "uint256",
    "name": "mintPrice_",
    "type": "uint256"
   },
   {
    "internalType": "uint256",
    "name": "maxPerWallet_",
    "type": "uint256"
   }
  ],
  "name": "setPrice",
  "outputs": [],
  "stateMutability": "nonpayable",
  "type": "function"
 },
 {
  "inputs": [
   {
    "components": [
     {
      "components": [
       {
        "internalType": "ctUint64[]",
        "name": "value",
        "type": "uint256[]"
       }
      ],
      "internalType": "struct ctString",
      "name": "ciphertext",
      "type": "tuple"
     },
     {
      "internalType": "bytes[]",
      "name": "signature",
      "type": "bytes[]"
     }
    ],
    "internalType": "struct itString",
    "name": "itSecret",
    "type": "tuple"
   }
  ],
  "name": "setSecret",
  "outputs": [],
  "stateMutability": "nonpayable",
  "type": "function"
 },
 {
  "inputs": [],
  "name": "symbol",
  "outputs": [
   {
    "internalType": "string",
    "name": "",
    "type": "string"
   }
  ],
  "stateMutability": "view",
  "type": "function"
 },
 {
  "inputs": [
   {
    "internalType": "uint256",
    "name": "tokenId",
    "type": "uint256"
   }
  ],
  "name": "tokenURI",
  "outputs": [
   {
    "components": [
     {
      "internalType": "ctUint64[]",
      "name": "value",
      "type": "uint256[]"
     }
    ],
    "internalType": "struct ctString",
    "name": "",
    "type": "tuple"
   }
  ],
  "stateMutability": "view",
  "type": "function"
 },
 {
  "inputs": [],
  "name": "totalMinted",
  "outputs": [
   {
    "internalType": "uint256",
    "name": "",
    "type": "uint256"
   }
  ],
  "stateMutability": "view",
  "type": "function"
 },
 {
  "inputs": [
   {
    "internalType": "address",
    "name": "from",
    "type": "address"
   },
   {
    "internalType": "address",
    "name": "to",
    "type": "address"
   },
   {
    "internalType": "uint256",
    "name": "tokenId",
    "type": "uint256"
   }
  ],
  "name": "transferFrom",
  "outputs": [],
  "stateMutability": "nonpayable",
  "type": "function"
 }
] as const;

export const devoxNFTEditionsAbi = [
 {
  "anonymous": false,
  "inputs": [
   {
    "indexed": true,
    "internalType": "uint256",
    "name": "id",
    "type": "uint256"
   },
   {
    "indexed": false,
    "internalType": "uint256",
    "name": "maxSupply",
    "type": "uint256"
   },
   {
    "indexed": false,
    "internalType": "uint256",
    "name": "price",
    "type": "uint256"
   },
   {
    "indexed": false,
    "internalType": "address",
    "name": "payToken",
    "type": "address"
   }
  ],
  "name": "EditionCreated",
  "type": "event"
 },
 {
  "anonymous": false,
  "inputs": [
   {
    "indexed": true,
    "internalType": "uint256",
    "name": "id",
    "type": "uint256"
   },
   {
    "indexed": true,
    "internalType": "address",
    "name": "to",
    "type": "address"
   },
   {
    "indexed": false,
    "internalType": "uint256",
    "name": "quantity",
    "type": "uint256"
   },
   {
    "indexed": false,
    "internalType": "uint256",
    "name": "paid",
    "type": "uint256"
   }
  ],
  "name": "EditionMinted",
  "type": "event"
 },
 {
  "anonymous": false,
  "inputs": [
   {
    "indexed": true,
    "internalType": "address",
    "name": "operator",
    "type": "address"
   },
   {
    "indexed": true,
    "internalType": "address",
    "name": "from",
    "type": "address"
   },
   {
    "indexed": true,
    "internalType": "address",
    "name": "to",
    "type": "address"
   },
   {
    "indexed": false,
    "internalType": "uint256",
    "name": "id",
    "type": "uint256"
   },
   {
    "indexed": false,
    "internalType": "uint256",
    "name": "value",
    "type": "uint256"
   }
  ],
  "name": "TransferSingle",
  "type": "event"
 },
 {
  "inputs": [
   {
    "internalType": "address",
    "name": "account",
    "type": "address"
   },
   {
    "internalType": "uint256",
    "name": "id",
    "type": "uint256"
   }
  ],
  "name": "balanceOf",
  "outputs": [
   {
    "internalType": "uint256",
    "name": "",
    "type": "uint256"
   }
  ],
  "stateMutability": "view",
  "type": "function"
 },
 {
  "inputs": [
   {
    "internalType": "address[]",
    "name": "accounts",
    "type": "address[]"
   },
   {
    "internalType": "uint256[]",
    "name": "ids",
    "type": "uint256[]"
   }
  ],
  "name": "balanceOfBatch",
  "outputs": [
   {
    "internalType": "uint256[]",
    "name": "out",
    "type": "uint256[]"
   }
  ],
  "stateMutability": "view",
  "type": "function"
 },
 {
  "inputs": [
   {
    "internalType": "uint256",
    "name": "maxSupply_",
    "type": "uint256"
   },
   {
    "internalType": "uint256",
    "name": "price_",
    "type": "uint256"
   },
   {
    "internalType": "address",
    "name": "payToken_",
    "type": "address"
   },
   {
    "internalType": "uint256",
    "name": "maxPerWallet_",
    "type": "uint256"
   },
   {
    "internalType": "uint64",
    "name": "opensAt_",
    "type": "uint64"
   },
   {
    "internalType": "uint64",
    "name": "closesAt_",
    "type": "uint64"
   },
   {
    "internalType": "string",
    "name": "previewURI_",
    "type": "string"
   },
   {
    "components": [
     {
      "components": [
       {
        "internalType": "ctUint64[]",
        "name": "value",
        "type": "uint256[]"
       }
      ],
      "internalType": "struct ctString",
      "name": "ciphertext",
      "type": "tuple"
     },
     {
      "internalType": "bytes[]",
      "name": "signature",
      "type": "bytes[]"
     }
    ],
    "internalType": "struct itString",
    "name": "itSecret",
    "type": "tuple"
   }
  ],
  "name": "createEdition",
  "outputs": [
   {
    "internalType": "uint256",
    "name": "id",
    "type": "uint256"
   }
  ],
  "stateMutability": "nonpayable",
  "type": "function"
 },
 {
  "inputs": [],
  "name": "editionCount",
  "outputs": [
   {
    "internalType": "uint256",
    "name": "",
    "type": "uint256"
   }
  ],
  "stateMutability": "view",
  "type": "function"
 },
 {
  "inputs": [
   {
    "internalType": "uint256",
    "name": "",
    "type": "uint256"
   }
  ],
  "name": "editions",
  "outputs": [
   {
    "internalType": "uint256",
    "name": "maxSupply",
    "type": "uint256"
   },
   {
    "internalType": "uint256",
    "name": "minted",
    "type": "uint256"
   },
   {
    "internalType": "uint256",
    "name": "price",
    "type": "uint256"
   },
   {
    "internalType": "address",
    "name": "payToken",
    "type": "address"
   },
   {
    "internalType": "uint256",
    "name": "maxPerWallet",
    "type": "uint256"
   },
   {
    "internalType": "uint64",
    "name": "opensAt",
    "type": "uint64"
   },
   {
    "internalType": "uint64",
    "name": "closesAt",
    "type": "uint64"
   },
   {
    "internalType": "string",
    "name": "previewURI",
    "type": "string"
   },
   {
    "internalType": "bool",
    "name": "exists",
    "type": "bool"
   }
  ],
  "stateMutability": "view",
  "type": "function"
 },
 {
  "inputs": [
   {
    "internalType": "address",
    "name": "account",
    "type": "address"
   },
   {
    "internalType": "address",
    "name": "operator",
    "type": "address"
   }
  ],
  "name": "isApprovedForAll",
  "outputs": [
   {
    "internalType": "bool",
    "name": "",
    "type": "bool"
   }
  ],
  "stateMutability": "view",
  "type": "function"
 },
 {
  "inputs": [
   {
    "internalType": "uint256",
    "name": "id",
    "type": "uint256"
   },
   {
    "internalType": "uint256",
    "name": "quantity",
    "type": "uint256"
   }
  ],
  "name": "mint",
  "outputs": [],
  "stateMutability": "payable",
  "type": "function"
 },
 {
  "inputs": [
   {
    "internalType": "uint256",
    "name": "id",
    "type": "uint256"
   },
   {
    "internalType": "address",
    "name": "who",
    "type": "address"
   }
  ],
  "name": "mintState",
  "outputs": [
   {
    "internalType": "bool",
    "name": "open",
    "type": "bool"
   },
   {
    "internalType": "string",
    "name": "reason",
    "type": "string"
   }
  ],
  "stateMutability": "view",
  "type": "function"
 },
 {
  "inputs": [
   {
    "internalType": "uint256",
    "name": "",
    "type": "uint256"
   },
   {
    "internalType": "address",
    "name": "",
    "type": "address"
   }
  ],
  "name": "mintedBy",
  "outputs": [
   {
    "internalType": "uint256",
    "name": "",
    "type": "uint256"
   }
  ],
  "stateMutability": "view",
  "type": "function"
 },
 {
  "inputs": [],
  "name": "name",
  "outputs": [
   {
    "internalType": "string",
    "name": "",
    "type": "string"
   }
  ],
  "stateMutability": "view",
  "type": "function"
 },
 {
  "inputs": [],
  "name": "owner",
  "outputs": [
   {
    "internalType": "address",
    "name": "",
    "type": "address"
   }
  ],
  "stateMutability": "view",
  "type": "function"
 },
 {
  "inputs": [],
  "name": "previewURI",
  "outputs": [
   {
    "internalType": "string",
    "name": "",
    "type": "string"
   }
  ],
  "stateMutability": "view",
  "type": "function"
 },
 {
  "inputs": [
   {
    "internalType": "address",
    "name": "from",
    "type": "address"
   },
   {
    "internalType": "address",
    "name": "to",
    "type": "address"
   },
   {
    "internalType": "uint256",
    "name": "id",
    "type": "uint256"
   },
   {
    "internalType": "uint256",
    "name": "value",
    "type": "uint256"
   },
   {
    "internalType": "bytes",
    "name": "data",
    "type": "bytes"
   }
  ],
  "name": "safeTransferFrom",
  "outputs": [],
  "stateMutability": "nonpayable",
  "type": "function"
 },
 {
  "inputs": [
   {
    "internalType": "uint256",
    "name": "id",
    "type": "uint256"
   },
   {
    "internalType": "address",
    "name": "holder",
    "type": "address"
   }
  ],
  "name": "secretOf",
  "outputs": [
   {
    "components": [
     {
      "internalType": "ctUint64[]",
      "name": "value",
      "type": "uint256[]"
     }
    ],
    "internalType": "struct ctString",
    "name": "",
    "type": "tuple"
   }
  ],
  "stateMutability": "view",
  "type": "function"
 },
 {
  "inputs": [
   {
    "internalType": "uint256",
    "name": "",
    "type": "uint256"
   }
  ],
  "name": "secretSet",
  "outputs": [
   {
    "internalType": "bool",
    "name": "",
    "type": "bool"
   }
  ],
  "stateMutability": "view",
  "type": "function"
 },
 {
  "inputs": [
   {
    "internalType": "address",
    "name": "operator",
    "type": "address"
   },
   {
    "internalType": "bool",
    "name": "approved",
    "type": "bool"
   }
  ],
  "name": "setApprovalForAll",
  "outputs": [],
  "stateMutability": "nonpayable",
  "type": "function"
 },
 {
  "inputs": [
   {
    "internalType": "uint256",
    "name": "id",
    "type": "uint256"
   },
   {
    "internalType": "uint256",
    "name": "price_",
    "type": "uint256"
   },
   {
    "internalType": "uint256",
    "name": "maxPerWallet_",
    "type": "uint256"
   }
  ],
  "name": "setEditionPrice",
  "outputs": [],
  "stateMutability": "nonpayable",
  "type": "function"
 },
 {
  "inputs": [
   {
    "internalType": "uint256",
    "name": "id",
    "type": "uint256"
   },
   {
    "internalType": "uint64",
    "name": "opensAt_",
    "type": "uint64"
   },
   {
    "internalType": "uint64",
    "name": "closesAt_",
    "type": "uint64"
   }
  ],
  "name": "setEditionWindow",
  "outputs": [],
  "stateMutability": "nonpayable",
  "type": "function"
 },
 {
  "inputs": [],
  "name": "symbol",
  "outputs": [
   {
    "internalType": "string",
    "name": "",
    "type": "string"
   }
  ],
  "stateMutability": "view",
  "type": "function"
 },
 {
  "inputs": [
   {
    "internalType": "uint256",
    "name": "",
    "type": "uint256"
   },
   {
    "internalType": "address",
    "name": "",
    "type": "address"
   }
  ],
  "name": "unlocked",
  "outputs": [
   {
    "internalType": "bool",
    "name": "",
    "type": "bool"
   }
  ],
  "stateMutability": "view",
  "type": "function"
 },
 {
  "inputs": [
   {
    "internalType": "uint256",
    "name": "id",
    "type": "uint256"
   }
  ],
  "name": "uri",
  "outputs": [
   {
    "internalType": "string",
    "name": "",
    "type": "string"
   }
  ],
  "stateMutability": "view",
  "type": "function"
 }
] as const;

export const devoxNFTFactoryAbi = [
 {
  "anonymous": false,
  "inputs": [
   {
    "indexed": true,
    "internalType": "address",
    "name": "collection",
    "type": "address"
   },
   {
    "indexed": true,
    "internalType": "address",
    "name": "creator",
    "type": "address"
   },
   {
    "indexed": false,
    "internalType": "string",
    "name": "name",
    "type": "string"
   },
   {
    "indexed": false,
    "internalType": "string",
    "name": "symbol",
    "type": "string"
   },
   {
    "indexed": false,
    "internalType": "uint256",
    "name": "maxSupply",
    "type": "uint256"
   },
   {
    "indexed": false,
    "internalType": "uint256",
    "name": "mintPrice",
    "type": "uint256"
   },
   {
    "indexed": false,
    "internalType": "address",
    "name": "payToken",
    "type": "address"
   }
  ],
  "name": "Launched",
  "type": "event"
 },
 {
  "inputs": [
   {
    "internalType": "uint256",
    "name": "i",
    "type": "uint256"
   }
  ],
  "name": "collectionAt",
  "outputs": [
   {
    "components": [
     {
      "internalType": "address",
      "name": "addr",
      "type": "address"
     },
     {
      "internalType": "address",
      "name": "creator",
      "type": "address"
     },
     {
      "internalType": "string",
      "name": "name",
      "type": "string"
     },
     {
      "internalType": "string",
      "name": "symbol",
      "type": "string"
     },
     {
      "internalType": "uint256",
      "name": "maxSupply",
      "type": "uint256"
     },
     {
      "internalType": "uint256",
      "name": "mintPrice",
      "type": "uint256"
     },
     {
      "internalType": "address",
      "name": "payToken",
      "type": "address"
     },
     {
      "internalType": "uint64",
      "name": "createdAt",
      "type": "uint64"
     }
    ],
    "internalType": "struct DevoxNFTFactory.Collection",
    "name": "",
    "type": "tuple"
   }
  ],
  "stateMutability": "view",
  "type": "function"
 },
 {
  "inputs": [],
  "name": "collectionCount",
  "outputs": [
   {
    "internalType": "uint256",
    "name": "",
    "type": "uint256"
   }
  ],
  "stateMutability": "view",
  "type": "function"
 },
 {
  "inputs": [
   {
    "internalType": "address",
    "name": "creator",
    "type": "address"
   }
  ],
  "name": "collectionsOf",
  "outputs": [
   {
    "internalType": "uint256[]",
    "name": "",
    "type": "uint256[]"
   }
  ],
  "stateMutability": "view",
  "type": "function"
 },
 {
  "inputs": [
   {
    "internalType": "bytes32",
    "name": "salt",
    "type": "bytes32"
   },
   {
    "components": [
     {
      "internalType": "string",
      "name": "name",
      "type": "string"
     },
     {
      "internalType": "string",
      "name": "symbol",
      "type": "string"
     },
     {
      "internalType": "string",
      "name": "previewURI",
      "type": "string"
     },
     {
      "internalType": "uint256",
      "name": "maxSupply",
      "type": "uint256"
     },
     {
      "internalType": "uint256",
      "name": "mintPrice",
      "type": "uint256"
     },
     {
      "internalType": "address",
      "name": "payToken",
      "type": "address"
     },
     {
      "internalType": "uint256",
      "name": "maxPerWallet",
      "type": "uint256"
     },
     {
      "internalType": "uint64",
      "name": "presaleStart",
      "type": "uint64"
     },
     {
      "internalType": "uint64",
      "name": "publicStart",
      "type": "uint64"
     }
    ],
    "internalType": "struct DevoxNFTFactory.DropParams",
    "name": "p",
    "type": "tuple"
   },
   {
    "internalType": "address",
    "name": "expected",
    "type": "address"
   }
  ],
  "name": "createDrop",
  "outputs": [
   {
    "internalType": "address",
    "name": "collection",
    "type": "address"
   }
  ],
  "stateMutability": "payable",
  "type": "function"
 },
 {
  "inputs": [
   {
    "components": [
     {
      "internalType": "string",
      "name": "name",
      "type": "string"
     },
     {
      "internalType": "string",
      "name": "symbol",
      "type": "string"
     },
     {
      "internalType": "string",
      "name": "previewURI",
      "type": "string"
     },
     {
      "internalType": "uint256",
      "name": "maxSupply",
      "type": "uint256"
     },
     {
      "internalType": "uint256",
      "name": "mintPrice",
      "type": "uint256"
     },
     {
      "internalType": "address",
      "name": "payToken",
      "type": "address"
     },
     {
      "internalType": "uint256",
      "name": "maxPerWallet",
      "type": "uint256"
     },
     {
      "internalType": "uint64",
      "name": "presaleStart",
      "type": "uint64"
     },
     {
      "internalType": "uint64",
      "name": "publicStart",
      "type": "uint64"
     }
    ],
    "internalType": "struct DevoxNFTFactory.DropParams",
    "name": "p",
    "type": "tuple"
   },
   {
    "internalType": "address",
    "name": "creator",
    "type": "address"
   }
  ],
  "name": "dropInitCodeHash",
  "outputs": [
   {
    "internalType": "bytes32",
    "name": "",
    "type": "bytes32"
   }
  ],
  "stateMutability": "pure",
  "type": "function"
 },
 {
  "inputs": [],
  "name": "feeRecipient",
  "outputs": [
   {
    "internalType": "address",
    "name": "",
    "type": "address"
   }
  ],
  "stateMutability": "view",
  "type": "function"
 },
 {
  "inputs": [
   {
    "internalType": "address",
    "name": "collection",
    "type": "address"
   }
  ],
  "name": "isFromFactory",
  "outputs": [
   {
    "internalType": "bool",
    "name": "from",
    "type": "bool"
   },
   {
    "components": [
     {
      "internalType": "address",
      "name": "addr",
      "type": "address"
     },
     {
      "internalType": "address",
      "name": "creator",
      "type": "address"
     },
     {
      "internalType": "string",
      "name": "name",
      "type": "string"
     },
     {
      "internalType": "string",
      "name": "symbol",
      "type": "string"
     },
     {
      "internalType": "uint256",
      "name": "maxSupply",
      "type": "uint256"
     },
     {
      "internalType": "uint256",
      "name": "mintPrice",
      "type": "uint256"
     },
     {
      "internalType": "address",
      "name": "payToken",
      "type": "address"
     },
     {
      "internalType": "uint64",
      "name": "createdAt",
      "type": "uint64"
     }
    ],
    "internalType": "struct DevoxNFTFactory.Collection",
    "name": "c",
    "type": "tuple"
   }
  ],
  "stateMutability": "view",
  "type": "function"
 },
 {
  "inputs": [],
  "name": "launchFee",
  "outputs": [
   {
    "internalType": "uint256",
    "name": "",
    "type": "uint256"
   }
  ],
  "stateMutability": "view",
  "type": "function"
 },
 {
  "inputs": [
   {
    "internalType": "uint256",
    "name": "offset",
    "type": "uint256"
   },
   {
    "internalType": "uint256",
    "name": "limit",
    "type": "uint256"
   }
  ],
  "name": "page",
  "outputs": [
   {
    "components": [
     {
      "internalType": "address",
      "name": "addr",
      "type": "address"
     },
     {
      "internalType": "address",
      "name": "creator",
      "type": "address"
     },
     {
      "internalType": "string",
      "name": "name",
      "type": "string"
     },
     {
      "internalType": "string",
      "name": "symbol",
      "type": "string"
     },
     {
      "internalType": "uint256",
      "name": "maxSupply",
      "type": "uint256"
     },
     {
      "internalType": "uint256",
      "name": "mintPrice",
      "type": "uint256"
     },
     {
      "internalType": "address",
      "name": "payToken",
      "type": "address"
     },
     {
      "internalType": "uint64",
      "name": "createdAt",
      "type": "uint64"
     }
    ],
    "internalType": "struct DevoxNFTFactory.Collection[]",
    "name": "out",
    "type": "tuple[]"
   }
  ],
  "stateMutability": "view",
  "type": "function"
 },
 {
  "inputs": [
   {
    "internalType": "bytes32",
    "name": "salt",
    "type": "bytes32"
   },
   {
    "components": [
     {
      "internalType": "string",
      "name": "name",
      "type": "string"
     },
     {
      "internalType": "string",
      "name": "symbol",
      "type": "string"
     },
     {
      "internalType": "string",
      "name": "previewURI",
      "type": "string"
     },
     {
      "internalType": "uint256",
      "name": "maxSupply",
      "type": "uint256"
     },
     {
      "internalType": "uint256",
      "name": "mintPrice",
      "type": "uint256"
     },
     {
      "internalType": "address",
      "name": "payToken",
      "type": "address"
     },
     {
      "internalType": "uint256",
      "name": "maxPerWallet",
      "type": "uint256"
     },
     {
      "internalType": "uint64",
      "name": "presaleStart",
      "type": "uint64"
     },
     {
      "internalType": "uint64",
      "name": "publicStart",
      "type": "uint64"
     }
    ],
    "internalType": "struct DevoxNFTFactory.DropParams",
    "name": "p",
    "type": "tuple"
   },
   {
    "internalType": "address",
    "name": "creator",
    "type": "address"
   }
  ],
  "name": "predictDrop",
  "outputs": [
   {
    "internalType": "address",
    "name": "",
    "type": "address"
   }
  ],
  "stateMutability": "view",
  "type": "function"
 }
] as const;

export const devoxNFTEditionsFactoryAbi = [
 {
  "anonymous": false,
  "inputs": [
   {
    "indexed": true,
    "internalType": "address",
    "name": "collection",
    "type": "address"
   },
   {
    "indexed": true,
    "internalType": "address",
    "name": "creator",
    "type": "address"
   },
   {
    "indexed": false,
    "internalType": "string",
    "name": "name",
    "type": "string"
   },
   {
    "indexed": false,
    "internalType": "string",
    "name": "symbol",
    "type": "string"
   }
  ],
  "name": "Launched",
  "type": "event"
 },
 {
  "inputs": [
   {
    "internalType": "uint256",
    "name": "i",
    "type": "uint256"
   }
  ],
  "name": "collectionAt",
  "outputs": [
   {
    "components": [
     {
      "internalType": "address",
      "name": "addr",
      "type": "address"
     },
     {
      "internalType": "address",
      "name": "creator",
      "type": "address"
     },
     {
      "internalType": "string",
      "name": "name",
      "type": "string"
     },
     {
      "internalType": "string",
      "name": "symbol",
      "type": "string"
     },
     {
      "internalType": "uint64",
      "name": "createdAt",
      "type": "uint64"
     }
    ],
    "internalType": "struct DevoxNFTEditionsFactory.Collection",
    "name": "",
    "type": "tuple"
   }
  ],
  "stateMutability": "view",
  "type": "function"
 },
 {
  "inputs": [],
  "name": "collectionCount",
  "outputs": [
   {
    "internalType": "uint256",
    "name": "",
    "type": "uint256"
   }
  ],
  "stateMutability": "view",
  "type": "function"
 },
 {
  "inputs": [
   {
    "internalType": "address",
    "name": "creator",
    "type": "address"
   }
  ],
  "name": "collectionsOf",
  "outputs": [
   {
    "internalType": "uint256[]",
    "name": "",
    "type": "uint256[]"
   }
  ],
  "stateMutability": "view",
  "type": "function"
 },
 {
  "inputs": [
   {
    "internalType": "bytes32",
    "name": "salt",
    "type": "bytes32"
   },
   {
    "components": [
     {
      "internalType": "string",
      "name": "name",
      "type": "string"
     },
     {
      "internalType": "string",
      "name": "symbol",
      "type": "string"
     },
     {
      "internalType": "string",
      "name": "previewURI",
      "type": "string"
     }
    ],
    "internalType": "struct DevoxNFTEditionsFactory.EditionsParams",
    "name": "p",
    "type": "tuple"
   },
   {
    "internalType": "address",
    "name": "expected",
    "type": "address"
   }
  ],
  "name": "createEditions",
  "outputs": [
   {
    "internalType": "address",
    "name": "collection",
    "type": "address"
   }
  ],
  "stateMutability": "payable",
  "type": "function"
 },
 {
  "inputs": [
   {
    "components": [
     {
      "internalType": "string",
      "name": "name",
      "type": "string"
     },
     {
      "internalType": "string",
      "name": "symbol",
      "type": "string"
     },
     {
      "internalType": "string",
      "name": "previewURI",
      "type": "string"
     }
    ],
    "internalType": "struct DevoxNFTEditionsFactory.EditionsParams",
    "name": "p",
    "type": "tuple"
   },
   {
    "internalType": "address",
    "name": "creator",
    "type": "address"
   }
  ],
  "name": "editionsInitCodeHash",
  "outputs": [
   {
    "internalType": "bytes32",
    "name": "",
    "type": "bytes32"
   }
  ],
  "stateMutability": "pure",
  "type": "function"
 },
 {
  "inputs": [
   {
    "internalType": "address",
    "name": "collection",
    "type": "address"
   }
  ],
  "name": "isFromFactory",
  "outputs": [
   {
    "internalType": "bool",
    "name": "from",
    "type": "bool"
   },
   {
    "components": [
     {
      "internalType": "address",
      "name": "addr",
      "type": "address"
     },
     {
      "internalType": "address",
      "name": "creator",
      "type": "address"
     },
     {
      "internalType": "string",
      "name": "name",
      "type": "string"
     },
     {
      "internalType": "string",
      "name": "symbol",
      "type": "string"
     },
     {
      "internalType": "uint64",
      "name": "createdAt",
      "type": "uint64"
     }
    ],
    "internalType": "struct DevoxNFTEditionsFactory.Collection",
    "name": "c",
    "type": "tuple"
   }
  ],
  "stateMutability": "view",
  "type": "function"
 },
 {
  "inputs": [],
  "name": "launchFee",
  "outputs": [
   {
    "internalType": "uint256",
    "name": "",
    "type": "uint256"
   }
  ],
  "stateMutability": "view",
  "type": "function"
 },
 {
  "inputs": [
   {
    "internalType": "uint256",
    "name": "offset",
    "type": "uint256"
   },
   {
    "internalType": "uint256",
    "name": "limit",
    "type": "uint256"
   }
  ],
  "name": "page",
  "outputs": [
   {
    "components": [
     {
      "internalType": "address",
      "name": "addr",
      "type": "address"
     },
     {
      "internalType": "address",
      "name": "creator",
      "type": "address"
     },
     {
      "internalType": "string",
      "name": "name",
      "type": "string"
     },
     {
      "internalType": "string",
      "name": "symbol",
      "type": "string"
     },
     {
      "internalType": "uint64",
      "name": "createdAt",
      "type": "uint64"
     }
    ],
    "internalType": "struct DevoxNFTEditionsFactory.Collection[]",
    "name": "out",
    "type": "tuple[]"
   }
  ],
  "stateMutability": "view",
  "type": "function"
 },
 {
  "inputs": [
   {
    "internalType": "bytes32",
    "name": "salt",
    "type": "bytes32"
   },
   {
    "components": [
     {
      "internalType": "string",
      "name": "name",
      "type": "string"
     },
     {
      "internalType": "string",
      "name": "symbol",
      "type": "string"
     },
     {
      "internalType": "string",
      "name": "previewURI",
      "type": "string"
     }
    ],
    "internalType": "struct DevoxNFTEditionsFactory.EditionsParams",
    "name": "p",
    "type": "tuple"
   },
   {
    "internalType": "address",
    "name": "creator",
    "type": "address"
   }
  ],
  "name": "predictEditions",
  "outputs": [
   {
    "internalType": "address",
    "name": "",
    "type": "address"
   }
  ],
  "stateMutability": "view",
  "type": "function"
 }
] as const;

export const devoxNFTMarketAbi = [
 {
  "anonymous": false,
  "inputs": [
   {
    "indexed": true,
    "internalType": "uint256",
    "name": "id",
    "type": "uint256"
   },
   {
    "indexed": true,
    "internalType": "address",
    "name": "collection",
    "type": "address"
   },
   {
    "indexed": true,
    "internalType": "uint256",
    "name": "tokenId",
    "type": "uint256"
   }
  ],
  "name": "Delisted",
  "type": "event"
 },
 {
  "anonymous": false,
  "inputs": [
   {
    "indexed": true,
    "internalType": "uint256",
    "name": "id",
    "type": "uint256"
   },
   {
    "indexed": true,
    "internalType": "address",
    "name": "collection",
    "type": "address"
   },
   {
    "indexed": true,
    "internalType": "uint256",
    "name": "tokenId",
    "type": "uint256"
   },
   {
    "indexed": false,
    "internalType": "address",
    "name": "seller",
    "type": "address"
   },
   {
    "indexed": false,
    "internalType": "address",
    "name": "payToken",
    "type": "address"
   },
   {
    "indexed": false,
    "internalType": "uint256",
    "name": "price",
    "type": "uint256"
   }
  ],
  "name": "Listed",
  "type": "event"
 },
 {
  "anonymous": false,
  "inputs": [
   {
    "indexed": true,
    "internalType": "uint256",
    "name": "id",
    "type": "uint256"
   },
   {
    "indexed": true,
    "internalType": "address",
    "name": "collection",
    "type": "address"
   },
   {
    "indexed": true,
    "internalType": "uint256",
    "name": "tokenId",
    "type": "uint256"
   },
   {
    "indexed": false,
    "internalType": "address",
    "name": "seller",
    "type": "address"
   },
   {
    "indexed": false,
    "internalType": "address",
    "name": "bidder",
    "type": "address"
   },
   {
    "indexed": false,
    "internalType": "uint256",
    "name": "amount",
    "type": "uint256"
   }
  ],
  "name": "OfferAccepted",
  "type": "event"
 },
 {
  "anonymous": false,
  "inputs": [
   {
    "indexed": true,
    "internalType": "uint256",
    "name": "id",
    "type": "uint256"
   },
   {
    "indexed": true,
    "internalType": "address",
    "name": "collection",
    "type": "address"
   },
   {
    "indexed": true,
    "internalType": "uint256",
    "name": "tokenId",
    "type": "uint256"
   },
   {
    "indexed": false,
    "internalType": "address",
    "name": "bidder",
    "type": "address"
   },
   {
    "indexed": false,
    "internalType": "address",
    "name": "payToken",
    "type": "address"
   },
   {
    "indexed": false,
    "internalType": "uint256",
    "name": "amount",
    "type": "uint256"
   }
  ],
  "name": "OfferMade",
  "type": "event"
 },
 {
  "anonymous": false,
  "inputs": [
   {
    "indexed": true,
    "internalType": "uint256",
    "name": "id",
    "type": "uint256"
   },
   {
    "indexed": true,
    "internalType": "address",
    "name": "collection",
    "type": "address"
   },
   {
    "indexed": true,
    "internalType": "uint256",
    "name": "tokenId",
    "type": "uint256"
   },
   {
    "indexed": false,
    "internalType": "address",
    "name": "seller",
    "type": "address"
   },
   {
    "indexed": false,
    "internalType": "address",
    "name": "buyer",
    "type": "address"
   },
   {
    "indexed": false,
    "internalType": "uint256",
    "name": "price",
    "type": "uint256"
   },
   {
    "indexed": false,
    "internalType": "uint256",
    "name": "fee",
    "type": "uint256"
   },
   {
    "indexed": false,
    "internalType": "uint256",
    "name": "royalty",
    "type": "uint256"
   }
  ],
  "name": "Sold",
  "type": "event"
 },
 {
  "inputs": [
   {
    "internalType": "uint256",
    "name": "id",
    "type": "uint256"
   }
  ],
  "name": "acceptOffer",
  "outputs": [],
  "stateMutability": "nonpayable",
  "type": "function"
 },
 {
  "inputs": [
   {
    "internalType": "uint256",
    "name": "id",
    "type": "uint256"
   }
  ],
  "name": "buy",
  "outputs": [],
  "stateMutability": "payable",
  "type": "function"
 },
 {
  "inputs": [
   {
    "internalType": "uint256",
    "name": "id",
    "type": "uint256"
   }
  ],
  "name": "cancelOffer",
  "outputs": [],
  "stateMutability": "nonpayable",
  "type": "function"
 },
 {
  "inputs": [
   {
    "internalType": "uint256",
    "name": "id",
    "type": "uint256"
   }
  ],
  "name": "delist",
  "outputs": [],
  "stateMutability": "nonpayable",
  "type": "function"
 },
 {
  "inputs": [],
  "name": "feeBps",
  "outputs": [
   {
    "internalType": "uint256",
    "name": "",
    "type": "uint256"
   }
  ],
  "stateMutability": "view",
  "type": "function"
 },
 {
  "inputs": [],
  "name": "feeRecipient",
  "outputs": [
   {
    "internalType": "address",
    "name": "",
    "type": "address"
   }
  ],
  "stateMutability": "view",
  "type": "function"
 },
 {
  "inputs": [
   {
    "internalType": "address",
    "name": "collection",
    "type": "address"
   },
   {
    "internalType": "uint256",
    "name": "tokenId",
    "type": "uint256"
   },
   {
    "internalType": "address",
    "name": "payToken",
    "type": "address"
   },
   {
    "internalType": "uint256",
    "name": "price",
    "type": "uint256"
   }
  ],
  "name": "list",
  "outputs": [
   {
    "internalType": "uint256",
    "name": "id",
    "type": "uint256"
   }
  ],
  "stateMutability": "nonpayable",
  "type": "function"
 },
 {
  "inputs": [
   {
    "internalType": "uint256",
    "name": "id",
    "type": "uint256"
   }
  ],
  "name": "listing",
  "outputs": [
   {
    "components": [
     {
      "internalType": "address",
      "name": "seller",
      "type": "address"
     },
     {
      "internalType": "address",
      "name": "collection",
      "type": "address"
     },
     {
      "internalType": "uint256",
      "name": "tokenId",
      "type": "uint256"
     },
     {
      "internalType": "address",
      "name": "payToken",
      "type": "address"
     },
     {
      "internalType": "uint256",
      "name": "price",
      "type": "uint256"
     },
     {
      "internalType": "bool",
      "name": "active",
      "type": "bool"
     },
     {
      "internalType": "uint64",
      "name": "listedAt",
      "type": "uint64"
     }
    ],
    "internalType": "struct DevoxNFTMarket.Listing",
    "name": "",
    "type": "tuple"
   }
  ],
  "stateMutability": "view",
  "type": "function"
 },
 {
  "inputs": [],
  "name": "listingCount",
  "outputs": [
   {
    "internalType": "uint256",
    "name": "",
    "type": "uint256"
   }
  ],
  "stateMutability": "view",
  "type": "function"
 },
 {
  "inputs": [
   {
    "internalType": "uint256",
    "name": "id",
    "type": "uint256"
   }
  ],
  "name": "listingLive",
  "outputs": [
   {
    "internalType": "bool",
    "name": "live",
    "type": "bool"
   },
   {
    "internalType": "string",
    "name": "reason",
    "type": "string"
   }
  ],
  "stateMutability": "view",
  "type": "function"
 },
 {
  "inputs": [
   {
    "internalType": "address",
    "name": "collection",
    "type": "address"
   },
   {
    "internalType": "uint256",
    "name": "tokenId",
    "type": "uint256"
   }
  ],
  "name": "listingOf",
  "outputs": [
   {
    "internalType": "bool",
    "name": "listed",
    "type": "bool"
   },
   {
    "internalType": "uint256",
    "name": "id",
    "type": "uint256"
   },
   {
    "components": [
     {
      "internalType": "address",
      "name": "seller",
      "type": "address"
     },
     {
      "internalType": "address",
      "name": "collection",
      "type": "address"
     },
     {
      "internalType": "uint256",
      "name": "tokenId",
      "type": "uint256"
     },
     {
      "internalType": "address",
      "name": "payToken",
      "type": "address"
     },
     {
      "internalType": "uint256",
      "name": "price",
      "type": "uint256"
     },
     {
      "internalType": "bool",
      "name": "active",
      "type": "bool"
     },
     {
      "internalType": "uint64",
      "name": "listedAt",
      "type": "uint64"
     }
    ],
    "internalType": "struct DevoxNFTMarket.Listing",
    "name": "l",
    "type": "tuple"
   }
  ],
  "stateMutability": "view",
  "type": "function"
 },
 {
  "inputs": [
   {
    "internalType": "address",
    "name": "collection",
    "type": "address"
   },
   {
    "internalType": "uint256",
    "name": "tokenId",
    "type": "uint256"
   },
   {
    "internalType": "address",
    "name": "payToken",
    "type": "address"
   },
   {
    "internalType": "uint256",
    "name": "amount",
    "type": "uint256"
   }
  ],
  "name": "makeOffer",
  "outputs": [
   {
    "internalType": "uint256",
    "name": "id",
    "type": "uint256"
   }
  ],
  "stateMutability": "nonpayable",
  "type": "function"
 },
 {
  "inputs": [
   {
    "internalType": "uint256",
    "name": "id",
    "type": "uint256"
   }
  ],
  "name": "offer",
  "outputs": [
   {
    "components": [
     {
      "internalType": "address",
      "name": "bidder",
      "type": "address"
     },
     {
      "internalType": "address",
      "name": "collection",
      "type": "address"
     },
     {
      "internalType": "uint256",
      "name": "tokenId",
      "type": "uint256"
     },
     {
      "internalType": "address",
      "name": "payToken",
      "type": "address"
     },
     {
      "internalType": "uint256",
      "name": "amount",
      "type": "uint256"
     },
     {
      "internalType": "bool",
      "name": "active",
      "type": "bool"
     },
     {
      "internalType": "uint64",
      "name": "madeAt",
      "type": "uint64"
     }
    ],
    "internalType": "struct DevoxNFTMarket.Offer",
    "name": "",
    "type": "tuple"
   }
  ],
  "stateMutability": "view",
  "type": "function"
 },
 {
  "inputs": [],
  "name": "offerCount",
  "outputs": [
   {
    "internalType": "uint256",
    "name": "",
    "type": "uint256"
   }
  ],
  "stateMutability": "view",
  "type": "function"
 },
 {
  "inputs": [
   {
    "internalType": "address",
    "name": "",
    "type": "address"
   }
  ],
  "name": "official",
  "outputs": [
   {
    "internalType": "bool",
    "name": "",
    "type": "bool"
   }
  ],
  "stateMutability": "view",
  "type": "function"
 },
 {
  "inputs": [
   {
    "internalType": "address",
    "name": "",
    "type": "address"
   }
  ],
  "name": "royaltyBps",
  "outputs": [
   {
    "internalType": "uint256",
    "name": "",
    "type": "uint256"
   }
  ],
  "stateMutability": "view",
  "type": "function"
 },
 {
  "inputs": [
   {
    "internalType": "address",
    "name": "",
    "type": "address"
   }
  ],
  "name": "royaltyRecipient",
  "outputs": [
   {
    "internalType": "address",
    "name": "",
    "type": "address"
   }
  ],
  "stateMutability": "view",
  "type": "function"
 },
 {
  "inputs": [
   {
    "internalType": "address",
    "name": "collection",
    "type": "address"
   },
   {
    "internalType": "bool",
    "name": "isOfficial",
    "type": "bool"
   }
  ],
  "name": "setOfficial",
  "outputs": [],
  "stateMutability": "nonpayable",
  "type": "function"
 },
 {
  "inputs": [
   {
    "internalType": "address",
    "name": "collection",
    "type": "address"
   },
   {
    "internalType": "address",
    "name": "recipient",
    "type": "address"
   },
   {
    "internalType": "uint256",
    "name": "bps",
    "type": "uint256"
   }
  ],
  "name": "setRoyalty",
  "outputs": [],
  "stateMutability": "nonpayable",
  "type": "function"
 }
] as const;

export const devoxNFTStakingAbi = [
 {
  "anonymous": false,
  "inputs": [
   {
    "indexed": true,
    "internalType": "address",
    "name": "who",
    "type": "address"
   },
   {
    "indexed": true,
    "internalType": "uint256",
    "name": "pid",
    "type": "uint256"
   },
   {
    "indexed": false,
    "internalType": "uint256",
    "name": "paid",
    "type": "uint256"
   },
   {
    "indexed": false,
    "internalType": "uint256",
    "name": "stillOwed",
    "type": "uint256"
   }
  ],
  "name": "Claimed",
  "type": "event"
 },
 {
  "anonymous": false,
  "inputs": [
   {
    "indexed": true,
    "internalType": "uint256",
    "name": "pid",
    "type": "uint256"
   },
   {
    "indexed": true,
    "internalType": "address",
    "name": "collection",
    "type": "address"
   },
   {
    "indexed": true,
    "internalType": "address",
    "name": "rewardToken",
    "type": "address"
   },
   {
    "indexed": false,
    "internalType": "uint256",
    "name": "rewardPerNftPerYear",
    "type": "uint256"
   },
   {
    "indexed": false,
    "internalType": "uint256",
    "name": "budget",
    "type": "uint256"
   }
  ],
  "name": "PoolOpened",
  "type": "event"
 },
 {
  "anonymous": false,
  "inputs": [
   {
    "indexed": true,
    "internalType": "address",
    "name": "who",
    "type": "address"
   },
   {
    "indexed": true,
    "internalType": "uint256",
    "name": "pid",
    "type": "uint256"
   },
   {
    "indexed": false,
    "internalType": "uint256",
    "name": "tokenId",
    "type": "uint256"
   }
  ],
  "name": "Staked",
  "type": "event"
 },
 {
  "anonymous": false,
  "inputs": [
   {
    "indexed": true,
    "internalType": "address",
    "name": "who",
    "type": "address"
   },
   {
    "indexed": true,
    "internalType": "uint256",
    "name": "pid",
    "type": "uint256"
   },
   {
    "indexed": false,
    "internalType": "uint256",
    "name": "tokenId",
    "type": "uint256"
   }
  ],
  "name": "Unstaked",
  "type": "event"
 },
 {
  "inputs": [
   {
    "internalType": "uint256",
    "name": "pid",
    "type": "uint256"
   },
   {
    "internalType": "uint256",
    "name": "amount",
    "type": "uint256"
   }
  ],
  "name": "addBudget",
  "outputs": [],
  "stateMutability": "nonpayable",
  "type": "function"
 },
 {
  "inputs": [
   {
    "internalType": "uint256",
    "name": "pid",
    "type": "uint256"
   }
  ],
  "name": "apyBps",
  "outputs": [
   {
    "internalType": "uint256",
    "name": "",
    "type": "uint256"
   }
  ],
  "stateMutability": "view",
  "type": "function"
 },
 {
  "inputs": [
   {
    "internalType": "uint256",
    "name": "pid",
    "type": "uint256"
   }
  ],
  "name": "claim",
  "outputs": [],
  "stateMutability": "nonpayable",
  "type": "function"
 },
 {
  "inputs": [
   {
    "internalType": "uint256",
    "name": "pid",
    "type": "uint256"
   },
   {
    "internalType": "uint256[]",
    "name": "tokenIds",
    "type": "uint256[]"
   }
  ],
  "name": "emergencyUnstake",
  "outputs": [],
  "stateMutability": "nonpayable",
  "type": "function"
 },
 {
  "inputs": [
   {
    "internalType": "address",
    "name": "collection",
    "type": "address"
   },
   {
    "internalType": "address",
    "name": "rewardToken",
    "type": "address"
   },
   {
    "internalType": "uint256",
    "name": "rewardPerNftPerYear",
    "type": "uint256"
   },
   {
    "internalType": "uint256",
    "name": "notionalPerNft",
    "type": "uint256"
   },
   {
    "internalType": "uint256",
    "name": "budget",
    "type": "uint256"
   }
  ],
  "name": "openPool",
  "outputs": [
   {
    "internalType": "uint256",
    "name": "pid",
    "type": "uint256"
   }
  ],
  "stateMutability": "nonpayable",
  "type": "function"
 },
 {
  "inputs": [
   {
    "internalType": "uint256",
    "name": "pid",
    "type": "uint256"
   },
   {
    "internalType": "address",
    "name": "who",
    "type": "address"
   }
  ],
  "name": "pendingReward",
  "outputs": [
   {
    "internalType": "uint256",
    "name": "",
    "type": "uint256"
   }
  ],
  "stateMutability": "view",
  "type": "function"
 },
 {
  "inputs": [
   {
    "internalType": "uint256",
    "name": "pid",
    "type": "uint256"
   }
  ],
  "name": "pool",
  "outputs": [
   {
    "components": [
     {
      "internalType": "contract IERC721",
      "name": "collection",
      "type": "address"
     },
     {
      "internalType": "contract IERC20",
      "name": "rewardToken",
      "type": "address"
     },
     {
      "internalType": "address",
      "name": "creator",
      "type": "address"
     },
     {
      "internalType": "uint256",
      "name": "rewardPerNftPerYear",
      "type": "uint256"
     },
     {
      "internalType": "uint256",
      "name": "notionalPerNft",
      "type": "uint256"
     },
     {
      "internalType": "uint256",
      "name": "budget",
      "type": "uint256"
     },
     {
      "internalType": "uint256",
      "name": "paidOut",
      "type": "uint256"
     },
     {
      "internalType": "uint256",
      "name": "staked",
      "type": "uint256"
     },
     {
      "internalType": "bool",
      "name": "active",
      "type": "bool"
     },
     {
      "internalType": "uint64",
      "name": "lastUpdate",
      "type": "uint64"
     },
     {
      "internalType": "uint256",
      "name": "accPerNft",
      "type": "uint256"
     }
    ],
    "internalType": "struct DevoxNFTStaking.Pool",
    "name": "",
    "type": "tuple"
   }
  ],
  "stateMutability": "view",
  "type": "function"
 },
 {
  "inputs": [],
  "name": "poolCount",
  "outputs": [
   {
    "internalType": "uint256",
    "name": "",
    "type": "uint256"
   }
  ],
  "stateMutability": "view",
  "type": "function"
 },
 {
  "inputs": [
   {
    "internalType": "address",
    "name": "collection",
    "type": "address"
   }
  ],
  "name": "poolOf",
  "outputs": [
   {
    "internalType": "bool",
    "name": "paired",
    "type": "bool"
   },
   {
    "internalType": "uint256",
    "name": "pid",
    "type": "uint256"
   }
  ],
  "stateMutability": "view",
  "type": "function"
 },
 {
  "inputs": [
   {
    "internalType": "uint256",
    "name": "pid",
    "type": "uint256"
   }
  ],
  "name": "runway",
  "outputs": [
   {
    "internalType": "uint256",
    "name": "",
    "type": "uint256"
   }
  ],
  "stateMutability": "view",
  "type": "function"
 },
 {
  "inputs": [
   {
    "internalType": "uint256",
    "name": "pid",
    "type": "uint256"
   },
   {
    "internalType": "uint256",
    "name": "rewardPerNftPerYear",
    "type": "uint256"
   },
   {
    "internalType": "bool",
    "name": "active",
    "type": "bool"
   }
  ],
  "name": "setPool",
  "outputs": [],
  "stateMutability": "nonpayable",
  "type": "function"
 },
 {
  "inputs": [
   {
    "internalType": "uint256",
    "name": "pid",
    "type": "uint256"
   },
   {
    "internalType": "uint256[]",
    "name": "tokenIds",
    "type": "uint256[]"
   }
  ],
  "name": "stake",
  "outputs": [],
  "stateMutability": "nonpayable",
  "type": "function"
 },
 {
  "inputs": [
   {
    "internalType": "uint256",
    "name": "pid",
    "type": "uint256"
   },
   {
    "internalType": "address",
    "name": "who",
    "type": "address"
   }
  ],
  "name": "stakeOf",
  "outputs": [
   {
    "components": [
     {
      "internalType": "uint256",
      "name": "count",
      "type": "uint256"
     },
     {
      "internalType": "uint256",
      "name": "rewardDebt",
      "type": "uint256"
     },
     {
      "internalType": "uint256",
      "name": "owed",
      "type": "uint256"
     }
    ],
    "internalType": "struct DevoxNFTStaking.Stake",
    "name": "",
    "type": "tuple"
   }
  ],
  "stateMutability": "view",
  "type": "function"
 },
 {
  "inputs": [
   {
    "internalType": "uint256",
    "name": "",
    "type": "uint256"
   },
   {
    "internalType": "uint256",
    "name": "",
    "type": "uint256"
   }
  ],
  "name": "stakerOf",
  "outputs": [
   {
    "internalType": "address",
    "name": "",
    "type": "address"
   }
  ],
  "stateMutability": "view",
  "type": "function"
 },
 {
  "inputs": [
   {
    "internalType": "uint256",
    "name": "pid",
    "type": "uint256"
   },
   {
    "internalType": "uint256[]",
    "name": "tokenIds",
    "type": "uint256[]"
   }
  ],
  "name": "unstake",
  "outputs": [],
  "stateMutability": "nonpayable",
  "type": "function"
 }
] as const;

